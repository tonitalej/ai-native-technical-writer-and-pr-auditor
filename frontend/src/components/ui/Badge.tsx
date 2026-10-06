import type { ReactNode } from 'react';

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const STATE_LABEL = { open: 'Open', draft: 'Draft', closed: 'Closed', merged: 'Merged' } as const;
const STATUS_LABEL = { pending: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed' } as const;
const RISK_LABEL = { none: 'None', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' } as const;

export function StateBadge({ state }: { state: keyof typeof STATE_LABEL }) {
  return <Badge tone={state}>{STATE_LABEL[state]}</Badge>;
}

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <Badge tone={status}>{STATUS_LABEL[status]}</Badge>;
}

export function RiskBadge({ level }: { level: keyof typeof RISK_LABEL | null }) {
  if (!level) {
    return null;
  }
  return <Badge tone={level}>{RISK_LABEL[level]} risk</Badge>;
}
