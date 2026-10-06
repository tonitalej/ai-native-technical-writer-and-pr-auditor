import type { AuditRecord, GitProviderName, PullRequestRecord, RepositoryRecord } from './domain.js';
import type { OmittedFile } from '../services/audits/diffSelection.js';
import type { SecurityFlag } from '../services/ai/schema.js';
import type { RiskLevel } from '../services/ai/postProcess.js';
import type { TokenUsage } from './domain.js';

export interface AuditFence {
  id: string;
  workerId: string;
  attempts: number;
}

export interface ClaimedAudit {
  id: string;
  pr_id: string;
  commit_sha: string;
  status: 'running';
  attempts: number;
  max_attempts: number;
  worker_id: string;
}

export interface ProcessingContext {
  audit: {
    id: string;
    pr_id: string;
    commit_sha: string;
    status: AuditRecord['status'];
    attempts: number;
    max_attempts: number;
    worker_id: string | null;
  };
  pullRequest: Pick<PullRequestRecord, 'id' | 'pr_number' | 'head_sha' | 'title'>;
  repository: Pick<
    RepositoryRecord,
    'id' | 'user_id' | 'provider' | 'owner' | 'repo_name' | 'provider_repository_id'
  > & { provider: GitProviderName };
}

export interface AuditCompletionWrite {
  status: 'completed';
  risk_level: RiskLevel;
  summary: string;
  generated_documentation: string;
  ai_security_flags: SecurityFlag[];
  model: string;
  prompt_version: string;
  token_usage: TokenUsage;
  diff_bytes: number;
  analyzed_diff_bytes: number;
  files_changed: number;
  diff_truncated: boolean;
  diff_omitted_files: OmittedFile[];
  duration_ms: number;
  completed_at: string;
  error_code: null;
  error_message: null;
}

export interface AuditFailureWrite {
  status: 'failed';
  error_code: string;
  error_message: string;
  duration_ms: number;
  completed_at: string;
}

export interface AuditHeartbeatWrite {
  heartbeat_at: string;
}

export type AuditFencedWrite = AuditCompletionWrite | AuditFailureWrite | AuditHeartbeatWrite;

export type OwnedAudit = AuditRecord;
