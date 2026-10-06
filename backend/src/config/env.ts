import { z } from 'zod';

import { DEV_CORS_ORIGIN } from './constants.js';

const booleanString = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: booleanString('false'),
  CORS_ORIGIN: z.string().optional().default(''),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional().default(''),
  SUPABASE_SECRET_KEY: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  CREDENTIAL_ENCRYPTION_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(128_000).default(8000),
  GITHUB_API_BASE_URL: z.string().url().default('https://api.github.com'),
  GITHUB_API_VERSION: z.string().min(1).default('2026-03-10'),
  GITHUB_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15_000),
  GITHUB_SYNC_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(10),
  AUDIT_WORKER_ENABLED: booleanString('true'),
  AUDIT_WORKER_INTERVAL_MS: z.coerce.number().int().min(100).default(2000),
  AUDIT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(1),
  AUDIT_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  AUDIT_STALE_AFTER_SECONDS: z.coerce.number().int().min(1).default(120),
  AUDIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  AUDIT_MAX_PROCESSING_MS: z.coerce.number().int().min(1000).default(600_000),
  AUDIT_MAX_DIFF_FETCH_BYTES: z.coerce.number().int().min(1).default(2_000_000),
  AUDIT_MAX_DIFF_ANALYZE_BYTES: z.coerce.number().int().min(1).default(300_000),
  MAX_ACTIVE_AUDITS_PER_USER: z.coerce.number().int().min(1).max(100).default(3),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  trustProxy: boolean;
  corsOrigins: string[];
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseSecretKey: string;
  supabaseKeyMode: 'publishable' | 'legacy';
  credentialEncryptionKey: Buffer;
  openaiApiKey: string;
  openaiModel: string;
  openaiTimeoutMs: number;
  openaiMaxOutputTokens: number;
  githubApiBaseUrl: string;
  githubApiVersion: string;
  githubTimeoutMs: number;
  githubSyncMaxPages: number;
  auditWorkerEnabled: boolean;
  auditWorkerIntervalMs: number;
  auditWorkerConcurrency: number;
  auditHeartbeatIntervalMs: number;
  auditStaleAfterSeconds: number;
  auditMaxAttempts: number;
  auditMaxProcessingMs: number;
  auditMaxDiffFetchBytes: number;
  auditMaxDiffAnalyzeBytes: number;
  maxActiveAuditsPerUser: number;
  shutdownTimeoutMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'env').join(', ');
    throw new Error(`Invalid environment: ${fields}`);
  }
  const value = parsed.data;

  const publishable = value.SUPABASE_PUBLISHABLE_KEY.trim();
  const secret = value.SUPABASE_SECRET_KEY.trim();
  const legacyPublishable = value.SUPABASE_ANON_KEY.trim();
  const legacySecret = value.SUPABASE_SERVICE_ROLE_KEY.trim();

  let supabasePublishableKey = '';
  let supabaseSecretKey = '';
  let supabaseKeyMode: AppConfig['supabaseKeyMode'] = 'publishable';
  if (publishable && secret) {
    supabasePublishableKey = publishable;
    supabaseSecretKey = secret;
    supabaseKeyMode = 'publishable';
  } else if (legacyPublishable && legacySecret) {
    supabasePublishableKey = legacyPublishable;
    supabaseSecretKey = legacySecret;
    supabaseKeyMode = 'legacy';
  } else {
    throw new Error(
      'Supabase keys are missing. Set SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY, or the legacy SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY pair.',
    );
  }

  const credentialEncryptionKey = decodeEncryptionKey(value.CREDENTIAL_ENCRYPTION_KEY);
  const heartbeatSeconds = value.AUDIT_HEARTBEAT_INTERVAL_MS / 1000;
  if (value.AUDIT_STALE_AFTER_SECONDS < 3 * heartbeatSeconds) {
    throw new Error(
      'AUDIT_STALE_AFTER_SECONDS must be at least 3× AUDIT_HEARTBEAT_INTERVAL_MS/1000.',
    );
  }

  const corsOrigins = value.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (value.NODE_ENV === 'production' && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGIN is required when NODE_ENV=production.');
  }
  if (value.NODE_ENV !== 'production' && corsOrigins.length === 0) {
    corsOrigins.push(DEV_CORS_ORIGIN);
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    logLevel: value.LOG_LEVEL,
    trustProxy: value.TRUST_PROXY,
    corsOrigins,
    supabaseUrl: value.SUPABASE_URL,
    supabasePublishableKey,
    supabaseSecretKey,
    supabaseKeyMode,
    credentialEncryptionKey,
    openaiApiKey: value.OPENAI_API_KEY,
    openaiModel: value.OPENAI_MODEL,
    openaiTimeoutMs: value.OPENAI_TIMEOUT_MS,
    openaiMaxOutputTokens: value.OPENAI_MAX_OUTPUT_TOKENS,
    githubApiBaseUrl: value.GITHUB_API_BASE_URL.replace(/\/+$/, ''),
    githubApiVersion: value.GITHUB_API_VERSION,
    githubTimeoutMs: value.GITHUB_TIMEOUT_MS,
    githubSyncMaxPages: value.GITHUB_SYNC_MAX_PAGES,
    auditWorkerEnabled: value.AUDIT_WORKER_ENABLED,
    auditWorkerIntervalMs: value.AUDIT_WORKER_INTERVAL_MS,
    auditWorkerConcurrency: value.AUDIT_WORKER_CONCURRENCY,
    auditHeartbeatIntervalMs: value.AUDIT_HEARTBEAT_INTERVAL_MS,
    auditStaleAfterSeconds: value.AUDIT_STALE_AFTER_SECONDS,
    auditMaxAttempts: value.AUDIT_MAX_ATTEMPTS,
    auditMaxProcessingMs: value.AUDIT_MAX_PROCESSING_MS,
    auditMaxDiffFetchBytes: value.AUDIT_MAX_DIFF_FETCH_BYTES,
    auditMaxDiffAnalyzeBytes: value.AUDIT_MAX_DIFF_ANALYZE_BYTES,
    maxActiveAuditsPerUser: value.MAX_ACTIVE_AUDITS_PER_USER,
    shutdownTimeoutMs: value.SHUTDOWN_TIMEOUT_MS,
  };
}

function decodeEncryptionKey(value: string): Buffer {
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length !== 32) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY must be base64 for exactly 32 bytes.');
  }
  return buffer;
}

/** Fields that are safe to write to the startup log. */
export function configLogSummary(config: AppConfig): Record<string, unknown> {
  return {
    node_env: config.nodeEnv,
    port: config.port,
    cors_origins: config.corsOrigins,
    supabase_key_mode: config.supabaseKeyMode,
    github_api_version: config.githubApiVersion,
    github_api_base_url: config.githubApiBaseUrl,
    openai_model: config.openaiModel,
    audit_worker_enabled: config.auditWorkerEnabled,
  };
}
