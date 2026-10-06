import { z } from 'zod';

import { repositorySchema, syncResultSchema, type Page, type Repository, type SyncResult } from '../types/api';
import { apiFetch } from './client';

const PAGE_LIMIT = 20;

export async function listRepositories(page: number): Promise<Page<Repository>> {
  const result = await apiFetch(
    `/api/repositories?page=${page}&limit=${PAGE_LIMIT}`,
    z.array(repositorySchema),
  );
  return {
    items: result.data,
    pagination: result.pagination ?? { page, limit: PAGE_LIMIT, total: result.data.length },
    requestId: result.requestId,
  };
}

export async function getRepository(repoId: string): Promise<{ repository: Repository; requestId: string | null }> {
  const result = await apiFetch(`/api/repositories/${repoId}`, repositorySchema);
  return { repository: result.data, requestId: result.requestId };
}

export async function connectRepository(
  repository: string,
  token: string,
): Promise<{ repository: Repository; created: boolean; requestId: string | null }> {
  const result = await apiFetch('/api/repositories', repositorySchema, {
    method: 'POST',
    body: { repository, token },
  });
  return { repository: result.data, created: result.status === 201, requestId: result.requestId };
}

export async function deleteRepository(repoId: string): Promise<void> {
  await apiFetch(`/api/repositories/${repoId}`, z.undefined(), { method: 'DELETE' });
}

export async function syncRepository(repoId: string): Promise<{ result: SyncResult; requestId: string | null }> {
  const response = await apiFetch(`/api/repositories/${repoId}/sync`, syncResultSchema, { method: 'POST' });
  return { result: response.data, requestId: response.requestId };
}
