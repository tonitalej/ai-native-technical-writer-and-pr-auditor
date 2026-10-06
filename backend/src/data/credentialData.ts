import type { SupabaseClient } from '@supabase/supabase-js';

import type { CredentialRecord } from '../types/domain.js';
import type { CredentialData } from './contracts.js';
import { parseCredential } from './rows.js';
import { raiseDatabaseError } from './supabaseErrors.js';

const CREDENTIAL_COLUMNS = 'repo_id, ciphertext, encryption_key_id, created_at, updated_at';

export function createCredentialData(supabase: SupabaseClient): CredentialData {
  return {
    async getForOwnedRepository(userId: string, repoId: string): Promise<CredentialRecord | null> {
      const { data, error } = await supabase
        .from('repository_credentials')
        .select(`${CREDENTIAL_COLUMNS}, repositories!inner(user_id)`)
        .eq('repo_id', repoId)
        .eq('repositories.user_id', userId)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseCredential(data) : null;
    },

    async updateForOwnedRepository(userId, repoId, ciphertext, encryptionKeyId) {
      const existing = await this.getForOwnedRepository(userId, repoId);
      if (!existing) {
        return false;
      }
      const { data, error } = await supabase
        .from('repository_credentials')
        .update({ ciphertext, encryption_key_id: encryptionKeyId })
        .eq('repo_id', repoId)
        .select('repo_id');
      raiseDatabaseError(error);
      return (data ?? []).length === 1;
    },
  };
}
