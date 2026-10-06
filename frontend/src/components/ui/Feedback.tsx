import type { ReactNode } from 'react';

import { Button } from './Button';

export function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="auth-wrap" role="status">
      <p>{label}…</p>
    </div>
  );
}

export function SkeletonList() {
  return (
    <div className="stack" aria-hidden="true">
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block" />
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="panel stack">
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {action}
    </section>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="panel stack" role="alert">
      <h2>Something went wrong</h2>
      <p>{message}</p>
      {onRetry ? (
        <div>
          <Button variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  if (pages <= 1) {
    return null;
  }
  return (
    <nav className="cluster" aria-label="Pagination">
      <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}
