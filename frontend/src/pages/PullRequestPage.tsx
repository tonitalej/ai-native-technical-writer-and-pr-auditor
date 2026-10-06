import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/errors';
import { ConnectDialog } from '../components/repositories/ConnectDialog';
import { SafeLink } from '../components/SafeLink';
import { RiskBadge, StateBadge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, Pagination, SkeletonList } from '../components/ui/Feedback';
import { ShaLine } from '../components/ui/CopyButton';
import { Time } from '../components/ui/Time';
import { useToast } from '../components/ui/Toast';
import { useAuditList, usePullRequest, useRepository } from '../hooks/useServerState';
import { useStartAudit } from '../hooks/useStartAudit';
import { presentApiError } from '../lib/auditCopy';
import { formatDuration, pageCount, shortSha } from '../lib/format';
import { NotFoundPage } from './NotFoundPage';

export function PullRequestPage() {
  const { prId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const auditPage = Math.max(1, Number(params.get('auditPage')) || 1);
  const pull = usePullRequest(prId);
  const audits = useAuditList(prId, auditPage);
  const repoId = pull.data?.pullRequest.repo_id ?? '';
  const repository = useRepository(repoId);
  const starter = useStartAudit(prId);
  const toast = useToast();
  const [connectOpen, setConnectOpen] = useState(params.get('reconnect') === '1');

  if (pull.isLoading) {
    return <SkeletonList />;
  }
  if (pull.error instanceof ApiError && pull.error.code === 'RESOURCE_NOT_FOUND') {
    return <NotFoundPage />;
  }
  if (pull.isError || !pull.data) {
    return <ErrorState message={pull.error instanceof ApiError ? presentApiError(pull.error) : 'Could not load the pull request.'} onRetry={() => void pull.refetch()} />;
  }

  const item = pull.data.pullRequest;
  const credentialInvalid = starter.message?.includes('token no longer works');

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <p className="kicker">
            {repository.data ? (
              <Link to={`/repositories/${repository.data.repository.id}`}>
                {repository.data.repository.owner}/{repository.data.repository.repo_name}
              </Link>
            ) : (
              'Pull request'
            )}
          </p>
          <h1>
            #{item.pr_number} {item.title}
          </h1>
          <dl className="facts">
            <div>
              <dt>State</dt>
              <dd><StateBadge state={item.state} /></dd>
            </div>
            <div>
              <dt>Author</dt>
              <dd>{item.author_login ?? 'unknown'}</dd>
            </div>
            <div>
              <dt>Branches</dt>
              <dd>{item.head_branch ?? 'unknown'} → {item.base_branch}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd><ShaLine sha={item.head_sha} /></dd>
            </div>
            {item.html_url ? (
              <div>
                <dt>GitHub</dt>
                <dd><SafeLink href={item.html_url}>View on GitHub</SafeLink></dd>
              </div>
            ) : null}
            {item.changed_files !== null ? (
              <div>
                <dt>Files</dt>
                <dd>{item.changed_files}</dd>
              </div>
            ) : null}
            {item.additions !== null && item.deletions !== null ? (
              <div>
                <dt>Diff</dt>
                <dd>
                  <span className="add">+{item.additions}</span> <span className="del">−{item.deletions}</span>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        <Button pending={starter.pending} disabled={starter.held} onClick={() => void starter.start()}>
          Start audit
        </Button>
      </div>
      {starter.message ? (
        <div className={`banner ${credentialInvalid ? 'banner-danger' : 'banner-warning'}`}>
          <p>{starter.message}</p>
          {credentialInvalid && repository.data ? (
            <Link to={`/repositories/${repository.data.repository.id}?reconnect=1`}>Reconnect</Link>
          ) : null}
        </div>
      ) : null}
      <h2>Audit history</h2>
      {audits.isLoading ? <SkeletonList /> : null}
      {audits.isError ? (
        <ErrorState message="Could not load audits." onRetry={() => void audits.refetch()} />
      ) : null}
      {audits.data && audits.data.items.length === 0 ? <EmptyState title="No audits yet" body="Start an audit to document this pull request and look for security issues." /> : null}
      {audits.data && audits.data.items.length > 0 ? (
        <div className="list">
          {audits.data.items.map((audit) => (
            <Link className="record" key={audit.id} to={`/audits/${audit.id}`}>
              <div className="record-top">
                <StatusBadge status={audit.status} />
                <RiskBadge level={audit.risk_level} />
                <span className="mono">{shortSha(audit.commit_sha)}</span>
                <Time value={audit.created_at} />
              </div>
              {audit.summary ? <p className="record-summary">{audit.summary.slice(0, 180)}</p> : null}
              <div className="record-foot">
                {audit.commit_sha !== item.head_sha ? <span>Audited an older commit</span> : null}
                {audit.flag_count !== undefined ? <span>{audit.flag_count} flags</span> : null}
                {audit.diff_truncated ? <span>Truncated</span> : null}
                {audit.duration_ms !== null ? <span>{formatDuration(audit.duration_ms)}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      <ConnectDialog
        open={connectOpen && Boolean(repository.data)}
        initialRepository={repository.data ? `${repository.data.repository.owner}/${repository.data.repository.repo_name}` : ''}
        onClose={() => setConnectOpen(false)}
        onConnected={(_repository, created) => {
          toast(created ? 'Repository connected' : 'Repository already connected. Token updated.');
        }}
      />
      {audits.data ? (
        <Pagination
          page={auditPage}
          pages={pageCount(audits.data.pagination.total, audits.data.pagination.limit)}
          onPage={(next) => {
            const updated = new URLSearchParams(params);
            if (next <= 1) {
              updated.delete('auditPage');
            } else {
              updated.set('auditPage', String(next));
            }
            setParams(updated);
          }}
        />
      ) : null}
    </section>
  );
}
