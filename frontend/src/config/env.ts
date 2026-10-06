import { z } from 'zod';

const url = z.string().trim().url();

export interface AppEnv {
  supabaseUrl: string;
  supabaseKey: string;
  supabaseKeySource: 'publishable' | 'anon';
  apiUrl: string;
}

export type EnvInput = Record<string, string | boolean | undefined>;

export type EnvResult =
  | { ok: true; env: AppEnv }
  | { ok: false; problems: string[] };

let warnedAnonFallback = false;

export function loadEnv(source: EnvInput): EnvResult {
  const problems: string[] = [];
  const supabaseUrl = readString(source, 'VITE_SUPABASE_URL');
  const apiUrl = readString(source, 'VITE_API_URL');
  const publishable = readString(source, 'VITE_SUPABASE_PUBLISHABLE_KEY');
  const anon = readString(source, 'VITE_SUPABASE_ANON_KEY');

  if (!supabaseUrl) {
    problems.push('VITE_SUPABASE_URL is missing.');
  }
  if (!apiUrl) {
    problems.push('VITE_API_URL is missing.');
  }
  if (!publishable && !anon) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing. VITE_SUPABASE_ANON_KEY is the legacy fallback.');
  }

  const parsedUrl = url.safeParse(supabaseUrl);
  if (supabaseUrl && !parsedUrl.success) {
    problems.push('VITE_SUPABASE_URL must be an http(s) URL.');
  }
  const parsedApi = url.safeParse(apiUrl);
  if (apiUrl && !parsedApi.success) {
    problems.push('VITE_API_URL must be an http(s) URL.');
  }

  if (problems.length > 0 || !parsedUrl.success || !parsedApi.success) {
    return { ok: false, problems };
  }

  const usingAnon = !publishable && Boolean(anon);
  if (usingAnon && !warnedAnonFallback) {
    warnedAnonFallback = true;
    console.warn(
      'VITE_SUPABASE_PUBLISHABLE_KEY is unset. Using VITE_SUPABASE_ANON_KEY. Prefer the publishable key.',
    );
  }

  return {
    ok: true,
    env: {
      supabaseUrl: parsedUrl.data.replace(/\/$/, ''),
      supabaseKey: publishable || anon,
      supabaseKeySource: usingAnon ? 'anon' : 'publishable',
      apiUrl: parsedApi.data.replace(/\/$/, ''),
    },
  };
}

export function resetEnvWarningForTests(): void {
  warnedAnonFallback = false;
}

function readString(source: EnvInput, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}
