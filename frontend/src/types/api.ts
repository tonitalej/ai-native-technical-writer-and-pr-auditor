import { z } from 'zod';

export const providerNameSchema = z.enum(['github', 'gitlab', 'bitbucket']);
export const pullRequestStateSchema = z.enum(['open', 'draft', 'closed', 'merged']);
export const auditStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export const riskLevelSchema = z.enum(['none', 'low', 'medium', 'high', 'critical']);
export const severitySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);
export const confidenceSchema = z.enum(['confirmed', 'potential']);
export const omittedReasonSchema = z.enum(['size_budget', 'no_patch', 'binary', 'fetch_cap']);

const timestamp = z.string().min(1);

/** Postgres bigint values sometimes arrive as decimal strings. */
const jsonIntNullable = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
}, z.number().int().nullable());

export const paginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
});

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  display_name: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const repositorySchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  provider: providerNameSchema,
  provider_repository_id: z.string(),
  owner: z.string(),
  repo_name: z.string(),
  repo_url: z.string(),
  default_branch: z.string(),
  is_private: z.boolean(),
  last_synced_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const pullRequestSchema = z.object({
  id: z.string().uuid(),
  repo_id: z.string().uuid(),
  pr_number: z.number().int(),
  provider_pr_id: z.string(),
  title: z.string(),
  author_login: z.string().nullable(),
  html_url: z.string().nullable(),
  base_branch: z.string(),
  head_branch: z.string().nullable(),
  head_sha: z.string(),
  state: pullRequestStateSchema,
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
  changed_files: z.number().int().nullable(),
  provider_created_at: timestamp.nullable(),
  provider_updated_at: timestamp.nullable(),
  closed_at: timestamp.nullable(),
  merged_at: timestamp.nullable(),
  last_synced_at: timestamp.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});

export const securityFlagSchema = z.object({
  severity: severitySchema,
  confidence: confidenceSchema,
  category: z.string(),
  title: z.string(),
  description: z.string(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  recommendation: z.string(),
});

export const omittedFileSchema = z.object({
  path: z.string(),
  reason: omittedReasonSchema,
});

export const tokenUsageSchema = z.object({
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  total_tokens: z.number().int(),
});

export const auditListItemSchema = z.object({
  id: z.string().uuid(),
  commit_sha: z.string(),
  status: auditStatusSchema,
  risk_level: riskLevelSchema.nullable(),
  summary: z.string(),
  flag_count: z.number().int().nonnegative().optional(),
  model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  diff_truncated: z.boolean(),
  duration_ms: jsonIntNullable,
  created_at: timestamp,
  completed_at: timestamp.nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
});

const auditIdentity = {
  id: z.string().uuid(),
  pr_id: z.string().uuid(),
  commit_sha: z.string(),
  created_at: timestamp,
};

export const auditSchema = z.discriminatedUnion('status', [
  z.object({
    ...auditIdentity,
    status: z.literal('pending'),
  }),
  z.object({
    ...auditIdentity,
    status: z.literal('running'),
  }),
  z.object({
    ...auditIdentity,
    status: z.literal('failed'),
    error_code: z.string().nullable(),
    error_message: z.string().nullable(),
    duration_ms: jsonIntNullable,
    completed_at: timestamp.nullable(),
  }),
  z.object({
    ...auditIdentity,
    status: z.literal('completed'),
    risk_level: riskLevelSchema,
    summary: z.string(),
    generated_documentation: z.string(),
    ai_security_flags: z.array(securityFlagSchema),
    model: z.string().nullable(),
    prompt_version: z.string().nullable(),
    token_usage: tokenUsageSchema,
    diff_bytes: jsonIntNullable,
    analyzed_diff_bytes: jsonIntNullable,
    files_changed: jsonIntNullable,
    diff_truncated: z.boolean(),
    diff_omitted_files: z.array(omittedFileSchema),
    duration_ms: jsonIntNullable,
    completed_at: timestamp.nullable(),
  }),
]);

export const createdAuditSchema = z.object({
  id: z.string().uuid(),
  pr_id: z.string().uuid(),
  commit_sha: z.string(),
  status: auditStatusSchema,
});

export const syncResultSchema = z.object({
  synced: z.number().int(),
  truncated: z.boolean(),
  last_synced_at: timestamp,
});

export const errorDetailsSchema = z
  .object({
    fields: z.array(z.string()).optional(),
    audit_id: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough();

export type User = z.infer<typeof userSchema>;
export type Repository = z.infer<typeof repositorySchema>;
export type PullRequest = z.infer<typeof pullRequestSchema>;
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;
export type SecurityFlag = z.infer<typeof securityFlagSchema>;
export type OmittedFile = z.infer<typeof omittedFileSchema>;
export type AuditListItem = z.infer<typeof auditListItemSchema>;
export type Audit = z.infer<typeof auditSchema>;
export type AuditStatus = z.infer<typeof auditStatusSchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type CreatedAudit = z.infer<typeof createdAuditSchema>;
export type SyncResult = z.infer<typeof syncResultSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type ErrorDetails = z.infer<typeof errorDetailsSchema>;

export interface Page<T> {
  items: T[];
  pagination: Pagination;
  requestId: string | null;
}

export interface ApiSuccess<T> {
  data: T;
  requestId: string | null;
  status: number;
}
