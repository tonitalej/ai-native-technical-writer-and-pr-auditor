import type { SupabaseClient } from '@supabase/supabase-js';

import type { GitProviderName, RepositoryRecord } from '../types/domain.js';
import { pageRange } from '../utils/pagination.js';
import type { CreateRepositoryInput, RepositoryData, RepositoryMetadataPatch } from './contracts.js';
import { REPOSITORY_COLUMNS, parseRepository } from './rows.js';
import { raiseDatabaseError, unwrapRow } from './supabaseErrors.js';

export function createRepositoryData(supabase: SupabaseClient): RepositoryData {
  return {
    async getOwned(userId: string, repoId: string): Promise<RepositoryRecord | null> {
      const { data, error } = await supabase
        .from('repositories')
        .select(REPOSITORY_COLUMNS)
        .eq('id', repoId)
        .eq('user_id', userId)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseRepository(data) : null;
    },

    async listOwned(userId, page, limit) {
      const { from, to } = pageRange(page, limit);
      const { data, error, count } = await supabase
        .from('repositories')
        .select(REPOSITORY_COLUMNS, { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      raiseDatabaseError(error);
      return {
        items: (data ?? []).map((row) => parseRepository(row)),
        total: count ?? 0,
      };
    },

    async findOwnedByProviderId(userId, provider, providerRepositoryId) {
      const { data, error } = await supabase
        .from('repositories')
        .select(REPOSITORY_COLUMNS)
        .eq('user_id', userId)
        .eq('provider', provider)
        .eq('provider_repository_id', providerRepositoryId)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseRepository(data) : null;
    },

    async findOwnedByOwnerName(userId, provider, owner, repoName) {
      const { data, error } = await supabase
        .from('repositories')
        .select(REPOSITORY_COLUMNS)
        .eq('user_id', userId)
        .eq('provider', provider)
        .filter('owner', 'imatch', anchored(owner))
        .filter('repo_name', 'imatch', anchored(repoName))
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseRepository(data) : null;
    },

    async createWithCredential(input: CreateRepositoryInput): Promise<RepositoryRecord> {
      const { data, error } = await supabase.rpc('create_repository_with_credential', {
        p_id: input.id,
        p_user_id: input.userId,
        p_provider: input.provider,
        p_provider_repository_id: input.providerRepositoryId,
        p_owner: input.owner,
        p_repo_name: input.repoName,
        p_repo_url: input.repoUrl,
        p_default_branch: input.defaultBranch,
        p_is_private: input.isPrivate,
        p_ciphertext: input.ciphertext,
        p_encryption_key_id: input.encryptionKeyId,
      });
      raiseDatabaseError(error);
      return parseRepository(unwrapRow(data));
    },

    async updateOwnedMetadata(userId, repoId, patch: RepositoryMetadataPatch) {
      const { data, error } = await supabase
        .from('repositories')
        .update({
          provider_repository_id: patch.providerRepositoryId,
          owner: patch.owner,
          repo_name: patch.repoName,
          repo_url: patch.repoUrl,
          default_branch: patch.defaultBranch,
          is_private: patch.isPrivate,
        })
        .eq('id', repoId)
        .eq('user_id', userId)
        .select(REPOSITORY_COLUMNS)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseRepository(data) : null;
    },

    async updateLastSyncedAt(userId, repoId, at) {
      const { data, error } = await supabase
        .from('repositories')
        .update({ last_synced_at: at })
        .eq('id', repoId)
        .eq('user_id', userId)
        .select('id');
      raiseDatabaseError(error);
      return (data ?? []).length === 1;
    },

    async deleteOwned(userId, repoId) {
      const { data, error } = await supabase
        .from('repositories')
        .delete()
        .eq('id', repoId)
        .eq('user_id', userId)
        .select('id');
      raiseDatabaseError(error);
      return (data ?? []).length === 1;
    },
  };
}

function anchored(value: string): string {
  return `^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

export type { GitProviderName };
