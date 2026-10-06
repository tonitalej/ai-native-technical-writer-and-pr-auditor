import type { SecurityFlag } from '../services/ai/schema.js';
import type { OmittedFile } from '../services/audits/diffSelection.js';
import type { RiskLevel } from '../services/ai/postProcess.js';

export type GitProviderName = 'github' | 'gitlab' | 'bitbucket';
export type PullRequestState = 'open' | 'draft' | 'closed' | 'merged';
export type AuditStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface UserRecord {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepositoryRecord {
  id: string;
  user_id: string;
  provider: GitProviderName;
  provider_repository_id: string;
  owner: string;
  repo_name: string;
  repo_url: string;
  default_branch: string;
  is_private: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CredentialRecord {
  repo_id: string;
  ciphertext: string;
  encryption_key_id: string;
  created_at: string;
  updated_at: string;
}

export interface PullRequestRecord {
  id: string;
  repo_id: string;
  pr_number: number;
  provider_pr_id: string;
  title: string;
  author_login: string | null;
  html_url: string | null;
  base_branch: string;
  head_branch: string | null;
  head_sha: string;
  state: PullRequestState;
  additions: number | null;
  deletions: number | null;
  changed_files: number | null;
  provider_created_at: string | null;
  provider_updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AuditRecord {
  id: string;
  pr_id: string;
  commit_sha: string;
  status: AuditStatus;
  risk_level: RiskLevel | null;
  summary: string;
  generated_documentation: string;
  ai_security_flags: SecurityFlag[];
  model: string | null;
  prompt_version: string | null;
  token_usage: TokenUsage;
  error_code: string | null;
  error_message: string | null;
  diff_bytes: number | null;
  analyzed_diff_bytes: number | null;
  files_changed: number | null;
  diff_truncated: boolean;
  diff_omitted_files: OmittedFile[];
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export const EMPTY_TOKEN_USAGE: TokenUsage = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
};
