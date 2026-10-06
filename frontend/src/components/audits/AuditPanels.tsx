import { useMemo, useState } from 'react';

import type { Audit, SecurityFlag, Severity } from '../../types/api';
import { failureAction, friendlyAuditFailure, omittedReasonLabel } from '../../lib/auditCopy';
import { formatDuration, formatKilobytes, shortSha } from '../../lib/format';
import { SafeMarkdown } from '../markdown/SafeMarkdown';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export function AuditFailure({
  code,
  backendMessage,
  requestId,
  pending,
  onStart,
  onReconnect,
}: {
  code: string | null;
  backendMessage: string | null;
  requestId: string | null;
  pending: boolean;
  onStart: () => void;
  onReconnect: () => void;
}) {
  const friendly = friendlyAuditFailure(code, backendMessage);
  const action = failureAction(code);
  return (
    <section className="panel stack" role="alert">
      <h2>{friendly}</h2>
      {backendMessage && backendMessage !== friendly ? <p>{backendMessage}</p> : null}
      {requestId ? <p className="muted">Reference: {requestId}</p> : null}
      {action === 'start' ? (
        <div>
          <Button pending={pending} onClick={onStart}>
            Start new audit
          </Button>
        </div>
      ) : null}
      {action === 'reconnect' ? (
        <div>
          <Button onClick={onReconnect}>Reconnect</Button>
        </div>
      ) : null}
    </section>
  );
}

export function CompletedAudit({ audit }: { audit: Extract<Audit, { status: 'completed' }> }) {
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [openOmitted, setOpenOmitted] = useState(false);
  const flags = useMemo(
    () => [...audit.ai_security_flags].sort((left, right) => SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity)),
    [audit.ai_security_flags],
  );
  const counts = SEVERITY_ORDER.map((level) => ({ level, count: flags.filter((flag) => flag.severity === level).length }));
  const visible = severity === 'all' ? flags : flags.filter((flag) => flag.severity === severity);

  function download() {
    const blob = new Blob([audit.generated_documentation], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-${shortSha(audit.commit_sha)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="stack">
      <section className="panel">
        <h2>Summary</h2>
        <p>{audit.summary}</p>
      </section>
      {audit.diff_truncated ? (
        <section className="banner banner-warning">
          <div>
            <p>
              This audit analyzed {formatKilobytes(audit.analyzed_diff_bytes ?? 0)} of {formatKilobytes(audit.diff_bytes ?? 0)} KB of the diff.
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => setOpenOmitted((value) => !value)} aria-expanded={openOmitted}>
              {openOmitted ? 'Hide omitted files' : 'Show omitted files'}
            </button>
            {openOmitted ? (
              <ul>
                {audit.diff_omitted_files.map((file) => (
                  <li key={`${file.path}-${file.reason}`}>
                    <code className="mono path">{file.path}</code> — {omittedReasonLabel(file.reason)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="stack">
        <h2>Security findings</h2>
        <div className="chips">
          <button type="button" className="chip" aria-pressed={severity === 'all'} onClick={() => setSeverity('all')}>
            All {flags.length}
          </button>
          {counts.map((item) => (
            <button key={item.level} type="button" className="chip" aria-pressed={severity === item.level} onClick={() => setSeverity(item.level)}>
              {item.level} {item.count}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <div className="panel">
            <p>No security findings</p>
            <p className="muted">This is not proof that the change is safe.</p>
          </div>
        ) : (
          visible.map((flag) => <Finding key={`${flag.title}-${flag.file ?? ''}-${flag.line ?? ''}`} flag={flag} />)
        )}
      </section>
      <section className="panel stack">
        <div className="section-head">
          <h2>Documentation</h2>
          <div className="actions">
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(audit.generated_documentation);
              }}
            >
              Copy
            </Button>
            <Button variant="ghost" onClick={download}>
              Download .md
            </Button>
          </div>
        </div>
        <SafeMarkdown source={audit.generated_documentation} />
      </section>
      <section className="panel">
        <h2>Usage</h2>
        <div className="usage">
          <span>Prompt {audit.token_usage.prompt_tokens}</span>
          <span>Completion {audit.token_usage.completion_tokens}</span>
          <span>Total {audit.token_usage.total_tokens}</span>
          {audit.duration_ms !== null ? <span>{formatDuration(audit.duration_ms)}</span> : null}
        </div>
      </section>
    </div>
  );
}

function Finding({ flag }: { flag: SecurityFlag }) {
  return (
    <article className="panel finding">
      <div className="cluster">
        <Badge tone={flag.severity}>{flag.severity}</Badge>
        <Badge tone={flag.confidence}>{flag.confidence === 'confirmed' ? 'Confirmed' : 'Potential'}</Badge>
        <span className="muted">{flag.category}</span>
      </div>
      <h3>{flag.title}</h3>
      <p>{flag.description}</p>
      {flag.file ? (
        <p className="mono path">
          {flag.file}
          {flag.line ? `:${flag.line}` : ''}
        </p>
      ) : null}
      <p>{flag.recommendation}</p>
    </article>
  );
}
