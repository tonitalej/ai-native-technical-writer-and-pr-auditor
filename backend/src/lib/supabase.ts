import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { AppConfig } from '../config/env.js';

const authOptions = {
  persistSession: false,
  autoRefreshToken: false,
} as const;

export interface SupabaseClients {
  auth: SupabaseClient;
  service: SupabaseClient;
}

export function createSupabaseClients(config: AppConfig): SupabaseClients {
  return {
    auth: createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: authOptions,
    }),
    service: createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: authOptions,
    }),
  };
}

export async function assertSupabaseReachable(service: SupabaseClient): Promise<void> {
  const { error } = await service.from('users').select('id').limit(1);
  if (error) {
    throw new Error(`Supabase startup check failed (${error.code ?? 'unknown'}).`);
  }
}
