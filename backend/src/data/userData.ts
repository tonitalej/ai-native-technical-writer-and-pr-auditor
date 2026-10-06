import type { SupabaseClient } from '@supabase/supabase-js';

import type { UserRecord } from '../types/domain.js';
import type { UserData } from './contracts.js';
import { parseUser } from './rows.js';
import { raiseDatabaseError } from './supabaseErrors.js';

const USER_COLUMNS = 'id, email, display_name, created_at, updated_at';

export function createUserData(supabase: SupabaseClient): UserData {
  return {
    async ensureUser(id: string, email: string | null): Promise<UserRecord> {
      const { data, error } = await supabase
        .from('users')
        .upsert({ id, email }, { onConflict: 'id' })
        .select(USER_COLUMNS)
        .single();
      raiseDatabaseError(error);
      return parseUser(data);
    },

    async getById(id: string): Promise<UserRecord | null> {
      const { data, error } = await supabase
        .from('users')
        .select(USER_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseUser(data) : null;
    },

    async updateDisplayName(id: string, displayName: string | null): Promise<UserRecord | null> {
      const { data, error } = await supabase
        .from('users')
        .update({ display_name: displayName })
        .eq('id', id)
        .select(USER_COLUMNS)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseUser(data) : null;
    },
  };
}
