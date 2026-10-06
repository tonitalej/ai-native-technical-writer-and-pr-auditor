import { z } from 'zod';

import { pullRequestSchema, type Page, type PullRequest, type PullRequestState } from '../types/api';
import { apiFetch } from './client';

const PAGE_LIMIT = 20;

export async function listPullRequests(
  repoId: string,
  page: number,
  state?: PullRequestState,
): Promise<Page<PullRequest>> {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
  if (state) {
    params.set('state', state);
  }
  const result = await apiFetch(
    `/api/repositories/${repoId}/pull-requests?${params.toString()}`,
    z.array(pullRequestSchema),
  );
  return {
    items: result.data,
    pagination: result.pagination ?? { page, limit: PAGE_LIMIT, total: result.data.length },
    requestId: result.requestId,
  };
}

export async function getPullRequest(prId: string): Promise<{ pullRequest: PullRequest; requestId: string | null }> {
  const result = await apiFetch(`/api/pull-requests/${prId}`, pullRequestSchema);
  return { pullRequest: result.data, requestId: result.requestId };
}
