import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ConnectDialog } from '../components/repositories/ConnectDialog';
import { DeleteDialog } from '../components/repositories/DeleteDialog';
import { SafeLink } from '../components/SafeLink';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, Pagination, SkeletonList } from '../components/ui/Feedback';
import { Time } from '../components/ui/Time';
import { useToast } from '../components/ui/Toast';
import { useRepositoryList } from '../hooks/useServerState';
import { pageCount } from '../lib/format';
import { ApiError } from '../api/errors';
import { presentApiError } from '../lib/auditCopy';

function pageFrom(params: URLSearchParams): number {
  const page = Number(params.get('page') ?? '1');
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function RepositoriesPage() {
  const [params, setParams] = useSearchParams();
  const page = pageFrom(params);
  const list = useRepositoryList(page);
  const toast = useToast();
  const navigate = useNavigate();
  const [connectOpen, setConnectOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

  function setPage(next: number) {
    const updated = new URLSearchParams(params);
    if (next <= 1) {
      updated.delete('page');
    } else {
      updated.set('page', String(next));
    }
    setParams(updated);
  }

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <p className="kicker">Workspace</p>
          <h1>Repositories</h1>
        </div>
        <Button onClick={() => setConnectOpen(true)}>Connect repository</Button>
      </div>
      {list.isLoading ? <SkeletonList /> : null}
      {list.isError ? (
        <ErrorState
          message={list.error instanceof ApiError ? presentApiError(list.error) : 'Could not load repositories.'}
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {list.data && list.data.items.length === 0 ? (
        <EmptyState
          title="No repositories yet"
          body="Connect a GitHub repository with a read-only token, then sync its pull requests."
          action={<Button onClick={() => setConnectOpen(true)}>Connect repository</Button>}
        />
      ) : null}
      {list.data && list.data.items.length > 0 ? (
        <div className="list">
          {list.data.items.map((repository) => {
            const name = `${repository.owner}/${repository.repo_name}`;
            return (
              <article className="card" key={repository.id}>
                <div className="row-between">
                  <Link to={`/repositories/${repository.id}`}>
                    <h2>{name}</h2>
                  </Link>
                  <Badge tone={repository.is_private ? 'draft' : 'open'}>{repository.is_private ? 'Private' : 'Public'}</Badge>
                </div>
                <div className="meta">
                  <span>Default branch {repository.default_branch}</span>
                  <span>
                    Last synced <Time value={repository.last_synced_at} />
                  </span>
                  <SafeLink href={repository.repo_url}>View on GitHub</SafeLink>
                </div>
                <div>
                  <Button variant="ghost" onClick={() => setPendingDelete({ id: repository.id, name })}>
                    Delete repository
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {list.data ? (
        <Pagination page={page} pages={pageCount(list.data.pagination.total, list.data.pagination.limit)} onPage={setPage} />
      ) : null}
      <ConnectDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onConnected={(repository, created) => {
          toast(created ? 'Repository connected' : 'Repository already connected. Token updated.');
          if (created) {
            navigate(`/repositories/${repository.id}`);
          }
        }}
      />
      <DeleteDialog
        open={pendingDelete !== null}
        repoId={pendingDelete?.id ?? ''}
        name={pendingDelete?.name ?? ''}
        onClose={() => setPendingDelete(null)}
        onDeleted={() => {
          setPendingDelete(null);
          toast('Repository deleted.');
        }}
      />
    </section>
  );
}
