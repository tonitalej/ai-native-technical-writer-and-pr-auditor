import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { syncRepository } from '../api/repositories';
import { ApiError } from '../api/errors';
import { ConnectDialog } from '../components/repositories/ConnectDialog';
import { StateBadge } from '../components/ui/Badge';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { EmptyState, ErrorState, Pagination, SkeletonList } from '../components/ui/Feedback';
import { Time } from '../components/ui/Time';
import { useToast } from '../components/ui/Toast';
import { usePullRequestList, useRepository } from '../hooks/useServerState';
import { presentApiError } from '../lib/auditCopy';
import { pageCount } from '../lib/format';
import { NotFoundPage } from './NotFoundPage';
import type { PullRequestState } from '../types/api';

const FILTERS: Array<{ id: 'all' | PullRequestState; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'draft', label: 'Draft' },
  { id: 'closed', label: 'Closed' },
  { id: 'merged', label: 'Merged' },
];

function parseState(value: string | null): PullRequestState | undefined {
  if (value === 'open' || value === 'draft' || value === 'closed' || value === 'merged') {
    return value;
  }
  return undefined;
}

export function RepositoryPage() {
  const { repoId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const state = parseState(params.get('state'));
  const repository = useRepository(repoId);
  const pulls = usePullRequestList(repoId, page, state);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [truncated, setTruncated] = useState(false);
  const [connectOpen, setConnectOpen] = useState(params.get('reconnect') === '1');
  const sync = useMutation({
    mutationFn: () => syncRepository(repoId),
    onSuccess: async (result) => {
      setTruncated(result.result.truncated);
      toast(`Synced ${result.result.synced} pull requests`);
      await queryClient.invalidateQueries({ queryKey: ['repository', repoId] });
      await queryClient.invalidateQueries({ queryKey: ['pull-requests', repoId] });
    },
  });

  function updateQuery(next: { page?: number; state?: PullRequestState | 'all' }) {
    const updated = new URLSearchParams(params);
    const pageValue = next.page ?? 1;
    if (pageValue <= 1) {
      updated.delete('page');
    } else {
      updated.set('page', String(pageValue));
    }
    if (next.state) {
      if (next.state === 'all') {
        updated.delete('state');
      } else {
        updated.set('state', next.state);
      }
    }
    updated.delete('reconnect');
    setParams(updated);
  }

  if (repository.isLoading) {
    return <SkeletonList />;
  }
  if (repository.error instanceof ApiError && repository.error.code === 'RESOURCE_NOT_FOUND') {
    return <NotFoundPage />;
  }
  if (repository.isError || !repository.data) {
    return (
      <ErrorState
        message={repository.error instanceof ApiError ? presentApiError(repository.error) : 'Could not load the repository.'}
        onRetry={() => void repository.refetch()}
      />
    );
  }

  const repo = repository.data.repository;
  const name = `${repo.owner}/${repo.repo_name}`;
  const credentialInvalid = sync.error instanceof ApiError && sync.error.code === 'PROVIDER_CREDENTIAL_INVALID';
  const neverSynced = repo.last_synced_at === null && (pulls.data?.items.length ?? 0) === 0;

  return (
    <section className="stack">
      <div className="page-head">
        <div>
          <p className="kicker">Repository</p>
          <h1>{name}</h1>
          <div className="meta">
            <Badge tone={repo.is_private ? 'draft' : 'open'}>{repo.is_private ? 'Private' : 'Public'}</Badge>
            <span>Default branch {repo.default_branch}</span>
            <span>
              Last synced <Time value={repo.last_synced_at} />
            </span>
          </div>
        </div>
        <Button pending={sync.isPending} onClick={() => void sync.mutate()}>
          Sync now
        </Button>
      </div>
      {credentialInvalid ? (
        <div className="banner banner-danger">
          <p>The stored GitHub token no longer works.</p>
          <Button onClick={() => setConnectOpen(true)}>Reconnect</Button>
        </div>
      ) : null}
      {sync.error instanceof ApiError && !credentialInvalid ? (
        <div className="banner banner-warning">
          <p>{presentApiError(sync.error)}</p>
          <Button variant="ghost" onClick={() => void sync.mutate()}>
            Retry
          </Button>
        </div>
      ) : null}
      {truncated ? <p className="banner banner-warning">Only the most recently updated pull requests were synced.</p> : null}
      <div className="tabs" role="tablist" aria-label="Pull request state">
        {FILTERS.map((filter) => {
          const current = (state ?? 'all') === filter.id;
          return (
            <Link
              key={filter.id}
              role="tab"
              aria-current={current ? 'page' : undefined}
              to={filter.id === 'all' ? `/repositories/${repoId}` : `/repositories/${repoId}?state=${filter.id}`}
            >
              {filter.label}
            </Link>
          );
        })}
      </div>
      {pulls.isLoading ? <SkeletonList /> : null}
      {pulls.isError ? (
        <ErrorState message={pulls.error instanceof ApiError ? presentApiError(pulls.error) : 'Could not load pull requests.'} onRetry={() => void pulls.refetch()} />
      ) : null}
      {neverSynced && !pulls.isLoading ? (
        <EmptyState title="This repository has not been synced" body="Sync now to pull in the latest pull requests." />
      ) : null}
      {pulls.data && pulls.data.items.length === 0 && !neverSynced ? (
        <EmptyState title="No pull requests" body="Nothing matches this filter yet." />
      ) : null}
      {pulls.data && pulls.data.items.length > 0 ? (
        <div className="list">
          {pulls.data.items.map((pull) => (
            <Link className="record" key={pull.id} to={`/pull-requests/${pull.id}`}>
              <div className="record-top">
                <strong>#{pull.pr_number}</strong>
                <StateBadge state={pull.state} />
                <Time value={pull.provider_updated_at ?? pull.updated_at} />
              </div>
              <p className="pr-title">{pull.title}</p>
              <div className="record-foot">
                <span>{pull.author_login ?? 'unknown'}</span>
                <span>
                  {pull.base_branch} ← {pull.head_branch ?? 'unknown'}
                </span>
                {pull.additions !== null && pull.deletions !== null ? (
                  <span>
                    <span className="add">+{pull.additions}</span> <span className="del">−{pull.deletions}</span>
                  </span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      ) : null}
      {pulls.data ? (
        <Pagination
          page={page}
          pages={pageCount(pulls.data.pagination.total, pulls.data.pagination.limit)}
          onPage={(next) => updateQuery({ page: next, state: state ?? 'all' })}
        />
      ) : null}
      <ConnectDialog
        open={connectOpen}
        initialRepository={name}
        onClose={() => setConnectOpen(false)}
        onConnected={(_repository, created) => {
          toast(created ? 'Repository connected' : 'Repository already connected. Token updated.');
        }}
      />
    </section>
  );
}
