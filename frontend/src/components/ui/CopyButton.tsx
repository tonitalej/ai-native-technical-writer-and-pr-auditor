import { useState } from 'react';

import { shortSha } from '../../lib/format';

export function ShaLine({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="sha">
      <code className="mono" title={sha}>
        {shortSha(sha)}
      </code>
      <button
        type="button"
        className="btn-mini"
        aria-label="Copy commit SHA"
        onClick={() => {
          void navigator.clipboard.writeText(sha).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}
