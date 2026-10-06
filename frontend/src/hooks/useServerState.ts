import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getMe, updateMe } from '../api/me';
import { getRepository, listRepositories } from '../api/repositories';
import { getPullRequest, listPullRequests } from '../api/pullRequests';
import { getAudit, listAudits } from '../api/audits';
import { auditListPollDelay, auditPollDelay, isPollingBlocked, AUDIT_POLL_CUTOFF_MS } from '../lib/polling';
import type { PullRequestState } from '../types/api';
import { useEffect, useRef, useState } from 'react';

export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled,
  });
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMe,
    onSuccess: (result) => {
      queryClient.setQueryData(['me'], result);
    },
  });
}

export function useRepositoryList(page: number) {
  return useQuery({
    queryKey: ['repositories', { page }],
    queryFn: () => listRepositories(page),
    placeholderData: keepPreviousData,
  });
}

export function useRepository(repoId: string) {
  return useQuery({
    queryKey: ['repository', repoId],
    queryFn: () => getRepository(repoId),
    enabled: repoId.length > 0,
  });
}

export function usePullRequestList(repoId: string, page: number, state?: PullRequestState) {
  return useQuery({
    queryKey: ['pull-requests', repoId, { page, state: state ?? 'all' }],
    queryFn: () => listPullRequests(repoId, page, state),
    placeholderData: keepPreviousData,
  });
}

export function usePullRequest(prId: string) {
  return useQuery({
    queryKey: ['pull-request', prId],
    queryFn: () => getPullRequest(prId),
  });
}

export function useAuditList(prId: string, page: number) {
  return useQuery({
    queryKey: ['audits', prId, { page }],
    queryFn: () => listAudits(prId, page),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const blocked = isPollingBlocked(query.state.error);
      const items = query.state.data?.items ?? [];
      const active = items.some((item) => item.status === 'pending' || item.status === 'running');
      return auditListPollDelay(active, blocked);
    },
  });
}

export function useAuditPolling(auditId: string) {
  const startedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const query = useQuery({
    queryKey: ['audit', auditId],
    queryFn: () => getAudit(auditId),
    refetchInterval: (current) => {
      const status = current.state.data?.audit.status;
      const blocked = isPollingBlocked(current.state.error);
      if ((status === 'pending' || status === 'running') && startedAt.current === null) {
        startedAt.current = Date.now();
      }
      if (status && status !== 'pending' && status !== 'running') {
        startedAt.current = null;
      }
      const elapsed = startedAt.current === null ? 0 : Date.now() - startedAt.current;
      return auditPollDelay(status, elapsed, blocked);
    },
  });

  const status = query.data?.audit.status;
  const inProgress = status === 'pending' || status === 'running';

  useEffect(() => {
    if (!inProgress) {
      return;
    }
    if (startedAt.current === null) {
      startedAt.current = Date.now();
    }
    const elapsed = Date.now() - startedAt.current;
    const remaining = Math.max(0, AUDIT_POLL_CUTOFF_MS - elapsed);
    const cutoffTimer = window.setTimeout(() => setNow(Date.now()), remaining);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(cutoffTimer);
      window.clearInterval(clock);
    };
  }, [inProgress]);

  const pollingFor = startedAt.current === null ? 0 : now - startedAt.current;
  const createdAt = query.data ? Date.parse(query.data.audit.created_at) : Number.NaN;
  return {
    ...query,
    cutoff: inProgress && pollingFor >= AUDIT_POLL_CUTOFF_MS,
    elapsedMs: inProgress && !Number.isNaN(createdAt) ? Math.max(0, now - createdAt) : 0,
  };
}
