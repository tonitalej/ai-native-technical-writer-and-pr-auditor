import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/errors';
import { AuditFailure, CompletedAudit } from '../components/audits/AuditPanels';
import { RiskBadge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { ErrorState, SkeletonList } from '../components/ui/Feedback';
import { ShaLine } from '../components/ui/CopyButton';
import { Time } from '../components/ui/Time';
import { useAuditPolling } from '../hooks/useServerState';
import { useStartAudit } from '../hooks/useStartAudit';
import { presentApiError } from '../lib/auditCopy';
import { formatDuration } from '../lib/format';
import { NotFoundPage } from './NotFoundPage';

export function AuditPage() {
  const { auditId = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const auditQuery = useAuditPolling(auditId);
  const prId = auditQuery.data?.audit.pr_id ?? '';
  const starter = useStartAudit(prId);

  if (auditQuery.isLoading) {
    return <SkeletonList />;
  }
  if (auditQuery.error instanceof ApiError && auditQuery.error.code === 'RESOURCE_NOT_FOUND') {
    return <NotFoundPage />;
  }
  if (auditQuery.isError || !auditQuery.data) {
    return (
      <ErrorState
        message={auditQuery.error instanceof ApiError ? presentApiError(auditQuery.error) : 'Could not load the audit.'}
        onRetry={() => void auditQuery.refetch()}
      />
    );
  }

  const audit = auditQuery.data.audit;
  const inProgress = audit.status === 'pending' || audit.status === 'running';

  return (
    <section className="stack">
      {notice ? <p className="banner">{notice}</p> : null}
      <div className="page-head">
        <div>
          <p className="kicker">
            <Link to={`/pull-requests/${audit.pr_id}`}>Back to pull request</Link>
          </p>
          <h1>Audit</h1>
          <dl className="facts">
            <div>
              <dt>Commit</dt>
              <dd><ShaLine sha={audit.commit_sha} /></dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><StatusBadge status={audit.status} /></dd>
            </div>
            {audit.status === 'completed' ? (
              <div>
                <dt>Risk</dt>
                <dd><RiskBadge level={audit.risk_level} /></dd>
              </div>
            ) : null}
            <div>
              <dt>Created</dt>
              <dd><Time value={audit.created_at} /></dd>
            </div>
            {audit.status !== 'pending' && audit.status !== 'running' && audit.completed_at ? (
              <div>
                <dt>Completed</dt>
                <dd><Time value={audit.completed_at} /></dd>
              </div>
            ) : null}
            {audit.status === 'completed' && audit.model ? (
              <div>
                <dt>Model</dt>
                <dd>{audit.model}</dd>
              </div>
            ) : null}
            {audit.status === 'completed' && audit.prompt_version ? (
              <div>
                <dt>Prompt</dt>
                <dd>{audit.prompt_version}</dd>
              </div>
            ) : null}
            {audit.status !== 'pending' && audit.status !== 'running' && audit.duration_ms !== null ? (
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(audit.duration_ms)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </div>
      {inProgress ? (
        <div className="progress" aria-live="polite">
          <div className="cluster">
            <span className="pulse" aria-hidden="true" />
            <strong>{audit.status === 'pending' ? 'Waiting in queue…' : 'Analyzing…'}</strong>
          </div>
          <p>Elapsed {formatDuration(auditQuery.elapsedMs)}</p>
          {auditQuery.cutoff ? (
            <div className="stack">
              <p>This is taking longer than expected. You can leave this page; the audit continues in the background.</p>
              <div>
                <Button variant="ghost" onClick={() => void auditQuery.refetch()}>
                  Refresh
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {audit.status === 'failed' ? (
        <AuditFailure
          code={audit.error_code}
          backendMessage={audit.error_message}
          requestId={auditQuery.data.requestId}
          pending={starter.pending}
          onStart={() => void starter.start()}
          onReconnect={() => navigate(`/pull-requests/${audit.pr_id}?reconnect=1`)}
        />
      ) : null}
      {audit.status === 'completed' ? <CompletedAudit audit={audit} /> : null}
    </section>
  );
}
