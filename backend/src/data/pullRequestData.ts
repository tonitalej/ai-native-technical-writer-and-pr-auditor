import type { SupabaseClient } from '@supabase/supabase-js';

import { PR_UPSERT_BATCH_SIZE } from '../config/constants.js';
import { pageRange } from '../utils/pagination.js';
import type { OwnedPullRequest, PullRequestData, PullRequestSyncRow } from './contracts.js';
import { PULL_REQUEST_COLUMNS, REPOSITORY_COLUMNS, parsePullRequest, parseRepository } from './rows.js';
import { raiseDatabaseError } from './supabaseErrors.js';

export function createPullRequestData(supabase: SupabaseClient): PullRequestData {
  return {
    async getOwned(userId, prId): Promise<OwnedPullRequest | null> {
      const { data, error } = await supabase
        .from('pull_requests')
        .select(`${PULL_REQUEST_COLUMNS}, repositories!inner(${REPOSITORY_COLUMNS})`)
        .eq('id', prId)
        .eq('repositories.user_id', userId)
        .maybeSingle();
      raiseDatabaseError(error);
      if (!data) {
        return null;
      }
      const record = data as Record<string, unknown>;
      const repository = one(record['repositories']);
      return {
        pullRequest: parsePullRequest(record),
        repository: parseRepository(repository),
      };
    },

    async listOwned(userId, repoId, page, limit, state) {
      const { from, to } = pageRange(page, limit);
      let query = supabase
        .from('pull_requests')
        .select(`${PULL_REQUEST_COLUMNS}, repositories!inner(user_id)`, { count: 'exact' })
        .eq('repo_id', repoId)
        .eq('repositories.user_id', userId);
      if (state) {
        query = query.eq('state', state);
      }
      const { data, error, count } = await query
        .order('pr_number', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      raiseDatabaseError(error);
      return {
        items: (data ?? []).map((row) => parsePullRequest(row)),
        total: count ?? 0,
      };
    },

    async upsertSynced(repoId, rows) {
      for (let index = 0; index < rows.length; index += PR_UPSERT_BATCH_SIZE) {
        const batch = rows.slice(index, index + PR_UPSERT_BATCH_SIZE).map((row) => toSyncPayload(repoId, row));
        const { error } = await supabase.from('pull_requests').upsert(batch, {
          onConflict: 'repo_id,pr_number',
        });
        raiseDatabaseError(error);
      }
    },

    async updateFromProvider(userId, prId, patch) {
      const owned = await this.getOwned(userId, prId);
      if (!owned) {
        return null;
      }
      const { data, error } = await supabase
        .from('pull_requests')
        .update({
          provider_pr_id: patch.provider_pr_id,
          pr_number: patch.pr_number,
          title: patch.title,
          author_login: patch.author_login,
          html_url: patch.html_url,
          base_branch: patch.base_branch,
          head_branch: patch.head_branch,
          head_sha: patch.head_sha,
          state: patch.state,
          additions: patch.additions,
          deletions: patch.deletions,
          changed_files: patch.changed_files,
          provider_created_at: patch.provider_created_at,
          provider_updated_at: patch.provider_updated_at,
          closed_at: patch.closed_at,
          merged_at: patch.merged_at,
          last_synced_at: patch.last_synced_at,
        })
        .eq('id', prId)
        .eq('repo_id', owned.repository.id)
        .select(PULL_REQUEST_COLUMNS)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parsePullRequest(data) : null;
    },
  };
}

function toSyncPayload(repoId: string, row: PullRequestSyncRow): Record<string, unknown> {
  return {
    repo_id: repoId,
    provider_pr_id: row.provider_pr_id,
    pr_number: row.pr_number,
    title: row.title,
    author_login: row.author_login,
    html_url: row.html_url,
    base_branch: row.base_branch,
    head_branch: row.head_branch,
    head_sha: row.head_sha,
    state: row.state,
    provider_created_at: row.provider_created_at,
    provider_updated_at: row.provider_updated_at,
    closed_at: row.closed_at,
    merged_at: row.merged_at,
    last_synced_at: row.last_synced_at,
  };
}

function one(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}
