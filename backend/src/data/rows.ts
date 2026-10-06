import { z } from 'zod';

import { securityFlagSchema } from '../services/ai/schema.js';
import type {
  AuditRecord,
  CredentialRecord,
  PullRequestRecord,
  RepositoryRecord,
  TokenUsage,
  UserRecord,
} from '../types/domain.js';
import { EMPTY_TOKEN_USAGE } from '../types/domain.js';
import { QueryError } from '../utils/errors.js';

const userRowSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const repositoryRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  provider: z.enum(['github', 'gitlab', 'bitbucket']),
  provider_repository_id: z.string(),
  owner: z.string(),
  repo_name: z.string(),
  repo_url: z.string(),
  default_branch: z.string(),
  is_private: z.boolean(),
  last_synced_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const credentialRowSchema = z.object({
  repo_id: z.string(),
  ciphertext: z.string(),
  encryption_key_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const pullRequestRowSchema = z.object({
  id: z.string(),
  repo_id: z.string(),
  pr_number: z.number().int(),
  provider_pr_id: z.string(),
  title: z.string(),
  author_login: z.string().nullable(),
  html_url: z.string().nullable(),
  base_branch: z.string(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
  state: z.enum(['open', 'draft', 'closed', 'merged']),
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  changed_files: z.number().int().nullable(),
  provider_created_at: z.string().nullable(),
  provider_updated_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  merged_at: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const omittedFileSchema = z.object({
  path: z.string(),
  reason: z.enum(['size_budget', 'no_patch', 'binary', 'fetch_cap']),
});

const tokenUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});

const auditRowSchema = z.object({
  id: z.string(),
  pr_id: z.string(),
  commit_sha: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  risk_level: z.enum(['none', 'low', 'medium', 'high', 'critical']).nullable(),
  summary: z.string(),
  generated_documentation: z.string(),
  ai_security_flags: z.array(z.unknown()),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  token_usage: tokenUsageSchema,
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  diff_bytes: z.number().int().nullable(),
  analyzed_diff_bytes: z.number().int().nullable(),
  files_changed: z.number().int().nullable(),
  diff_truncated: z.boolean(),
  diff_omitted_files: z.array(omittedFileSchema),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  worker_id: z.string().nullable(),
  started_at: z.string().nullable(),
  heartbeat_at: z.string().nullable(),
  duration_ms: z
    .union([z.number().int(), z.string().regex(/^\d+$/)])
    .nullable()
    .transform((value) => (value === null ? null : Number(value))),
  created_at: z.string(),
  updated_at: z.string(),
  completed_at: z.string().nullable(),
});

function parse<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new QueryError(`invalid_${label}`);
  }
  return parsed.data;
}

export function parseUser(data: unknown): UserRecord {
  return parse(userRowSchema, data, 'user');
}

export function parseRepository(data: unknown): RepositoryRecord {
  return parse(repositoryRowSchema, data, 'repository');
}

export function parseCredential(data: unknown): CredentialRecord {
  return parse(credentialRowSchema, data, 'credential');
}

export function parsePullRequest(data: unknown): PullRequestRecord {
  return parse(pullRequestRowSchema, data, 'pull_request');
}

export function parseAudit(data: unknown): AuditRecord {
  const row = parse(auditRowSchema, data, 'audit');
  const flags = row.ai_security_flags.map((flag) => {
    const parsed = securityFlagSchema.safeParse(flag);
    if (!parsed.success) {
      throw new QueryError('invalid_audit_flags');
    }
    return parsed.data;
  });
  const usage: TokenUsage = {
    prompt_tokens: row.token_usage.prompt_tokens,
    completion_tokens: row.token_usage.completion_tokens,
    total_tokens: row.token_usage.total_tokens,
  };
  return { ...row, ai_security_flags: flags, token_usage: usage };
}

export function emptyUsage(): TokenUsage {
  return { ...EMPTY_TOKEN_USAGE };
}

export const REPOSITORY_COLUMNS =
  'id, user_id, provider, provider_repository_id, owner, repo_name, repo_url, default_branch, is_private, last_synced_at, created_at, updated_at';

export const PULL_REQUEST_COLUMNS =
  'id, repo_id, pr_number, provider_pr_id, title, author_login, html_url, base_branch, head_branch, head_sha, state, additions, deletions, changed_files, provider_created_at, provider_updated_at, closed_at, merged_at, last_synced_at, created_at, updated_at';

export const AUDIT_COLUMNS =
  'id, pr_id, commit_sha, status, risk_level, summary, generated_documentation, ai_security_flags, model, prompt_version, token_usage, error_code, error_message, diff_bytes, analyzed_diff_bytes, files_changed, diff_truncated, diff_omitted_files, attempts, max_attempts, worker_id, started_at, heartbeat_at, duration_ms, created_at, updated_at, completed_at';

export const AUDIT_LIST_COLUMNS =
  'id, pr_id, commit_sha, status, risk_level, summary, ai_security_flags, model, prompt_version, diff_truncated, duration_ms, created_at, completed_at, error_code, error_message';
