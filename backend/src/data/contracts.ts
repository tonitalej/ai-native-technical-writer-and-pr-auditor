import type { AuditFencedWrite, AuditFence, ClaimedAudit, ProcessingContext } from '../types/audit.js';
import type {
  AuditRecord,
  CredentialRecord,
  GitProviderName,
  PullRequestRecord,
  PullRequestState,
  RepositoryRecord,
  UserRecord,
} from '../types/domain.js';

export interface UserData {
  ensureUser(id: string, email: string | null): Promise<UserRecord>;
  getById(id: string): Promise<UserRecord | null>;
  updateDisplayName(id: string, displayName: string | null): Promise<UserRecord | null>;
}

export interface CreateRepositoryInput {
  id: string;
  userId: string;
  provider: GitProviderName;
  providerRepositoryId: string;
  owner: string;
  repoName: string;
  repoUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  ciphertext: string;
  encryptionKeyId: string;
}

export interface RepositoryMetadataPatch {
  providerRepositoryId: string;
  owner: string;
  repoName: string;
  repoUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface RepositoryData {
  getOwned(userId: string, repoId: string): Promise<RepositoryRecord | null>;
  listOwned(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ items: RepositoryRecord[]; total: number }>;
  findOwnedByProviderId(
    userId: string,
    provider: GitProviderName,
    providerRepositoryId: string,
  ): Promise<RepositoryRecord | null>;
  findOwnedByOwnerName(
    userId: string,
    provider: GitProviderName,
    owner: string,
    repoName: string,
  ): Promise<RepositoryRecord | null>;
  createWithCredential(input: CreateRepositoryInput): Promise<RepositoryRecord>;
  updateOwnedMetadata(userId: string, repoId: string, patch: RepositoryMetadataPatch): Promise<RepositoryRecord | null>;
  updateLastSyncedAt(userId: string, repoId: string, at: string): Promise<boolean>;
  deleteOwned(userId: string, repoId: string): Promise<boolean>;
}

export interface CredentialData {
  getForOwnedRepository(userId: string, repoId: string): Promise<CredentialRecord | null>;
  updateForOwnedRepository(
    userId: string,
    repoId: string,
    ciphertext: string,
    encryptionKeyId: string,
  ): Promise<boolean>;
}

export interface PullRequestSyncRow {
  provider_pr_id: string;
  pr_number: number;
  title: string;
  author_login: string | null;
  html_url: string | null;
  base_branch: string;
  head_branch: string | null;
  head_sha: string;
  state: PullRequestState;
  provider_created_at: string | null;
  provider_updated_at: string | null;
  closed_at: string | null;
  merged_at: string | null;
  last_synced_at: string;
}

export interface PullRequestDetailPatch extends PullRequestSyncRow {
  additions: number;
  deletions: number;
  changed_files: number;
}

export interface OwnedPullRequest {
  pullRequest: PullRequestRecord;
  repository: RepositoryRecord;
}

export interface PullRequestData {
  getOwned(userId: string, prId: string): Promise<OwnedPullRequest | null>;
  listOwned(
    userId: string,
    repoId: string,
    page: number,
    limit: number,
    state?: PullRequestState,
  ): Promise<{ items: PullRequestRecord[]; total: number }>;
  upsertSynced(repoId: string, rows: readonly PullRequestSyncRow[]): Promise<void>;
  updateFromProvider(userId: string, prId: string, patch: PullRequestDetailPatch): Promise<PullRequestRecord | null>;
}

export interface AuditListRecord {
  id: string;
  pr_id: string;
  commit_sha: string;
  status: AuditRecord['status'];
  risk_level: AuditRecord['risk_level'];
  summary: string;
  ai_security_flags: AuditRecord['ai_security_flags'];
  model: string | null;
  prompt_version: string | null;
  diff_truncated: boolean;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface AuditData {
  countActiveForUser(userId: string): Promise<number>;
  insertPending(input: {
    userId: string;
    prId: string;
    commitSha: string;
    maxAttempts: number;
    maxActive: number;
  }): Promise<{
    id: string;
    pr_id: string;
    commit_sha: string;
    status: 'pending';
  }>;
  findInflightForOwnedPullRequest(
    userId: string,
    prId: string,
    commitSha: string,
  ): Promise<{ id: string; status: AuditRecord['status'] } | null>;
  listForOwnedPullRequest(
    userId: string,
    prId: string,
    page: number,
    limit: number,
  ): Promise<{ items: AuditListRecord[]; total: number }>;
  getOwned(userId: string, auditId: string): Promise<AuditRecord | null>;
  claimNext(workerId: string): Promise<ClaimedAudit | null>;
  recoverStale(staleAfterSeconds: number): Promise<{ requeued: number; exhausted: number }>;
  fencedUpdate(fence: AuditFence, patch: AuditFencedWrite): Promise<boolean>;
  insertOwnedDiff(fence: AuditFence, rawDiff: string): Promise<boolean>;
  getProcessingContext(auditId: string): Promise<ProcessingContext | null>;
}
