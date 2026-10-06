import { randomUUID } from 'node:crypto';

import type {
  AuditData,
  AuditListRecord,
  CreateRepositoryInput,
  CredentialData,
  PullRequestData,
  PullRequestDetailPatch,
  PullRequestSyncRow,
  RepositoryData,
  RepositoryMetadataPatch,
  UserData,
} from '../../src/data/contracts.js';
import type { AuditFencedWrite, AuditFence, ClaimedAudit, ProcessingContext } from '../../src/types/audit.js';
import type {
  AuditRecord,
  CredentialRecord,
  PullRequestRecord,
  PullRequestState,
  RepositoryRecord,
  UserRecord,
} from '../../src/types/domain.js';
import { EMPTY_TOKEN_USAGE } from '../../src/types/domain.js';
import { ActiveAuditCapError, UniqueViolationError, resourceNotFound } from '../../src/utils/errors.js';

const EXHAUSTED_MESSAGE =
  'The audit was interrupted repeatedly and was stopped. Please start a new audit.';

export class MemoryDatabase {
  readonly users = new Map<string, UserRecord>();
  readonly repositories = new Map<string, RepositoryRecord>();
  readonly credentials = new Map<string, CredentialRecord>();
  readonly pullRequests = new Map<string, PullRequestRecord>();
  readonly audits = new Map<string, AuditRecord>();
  readonly diffs = new Map<string, string>();
  failNextCreate = false;
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  async ensureUser(id: string, email: string | null): Promise<UserRecord> {
    const existing = this.users.get(id);
    if (existing) {
      existing.email = email;
      existing.updated_at = this.timestamp();
      return clone(existing);
    }
    const now = this.timestamp();
    const created: UserRecord = {
      id,
      email,
      display_name: null,
      created_at: now,
      updated_at: now,
    };
    this.users.set(id, created);
    return clone(created);
  }

  async getById(id: string): Promise<UserRecord | null> {
    const user = this.users.get(id);
    return user ? clone(user) : null;
  }

  async updateDisplayName(id: string, displayName: string | null): Promise<UserRecord | null> {
    const user = this.users.get(id);
    if (!user) {
      return null;
    }
    user.display_name = displayName;
    user.updated_at = this.timestamp();
    return clone(user);
  }

  async getRepositoryOwned(userId: string, repoId: string): Promise<RepositoryRecord | null> {
    const repository = this.repositories.get(repoId);
    if (!repository || repository.user_id !== userId) {
      return null;
    }
    return clone(repository);
  }

  async listRepositories(userId: string, page: number, limit: number) {
    const items = [...this.repositories.values()]
      .filter((repository) => repository.user_id === userId)
      .sort(byCreatedThenId);
    return paginate(items, page, limit);
  }

  async findOwnedByProviderId(userId: string, provider: RepositoryRecord['provider'], providerRepositoryId: string) {
    const found = [...this.repositories.values()].find(
      (repository) =>
        repository.user_id === userId &&
        repository.provider === provider &&
        repository.provider_repository_id === providerRepositoryId,
    );
    return found ? clone(found) : null;
  }

  async findOwnedByOwnerName(userId: string, provider: RepositoryRecord['provider'], owner: string, repoName: string) {
    const found = [...this.repositories.values()].find(
      (repository) =>
        repository.user_id === userId &&
        repository.provider === provider &&
        repository.owner.toLowerCase() === owner.toLowerCase() &&
        repository.repo_name.toLowerCase() === repoName.toLowerCase(),
    );
    return found ? clone(found) : null;
  }

  async createWithCredential(input: CreateRepositoryInput): Promise<RepositoryRecord> {
    this.assertRepositoryUnique(input);
    if (this.failNextCreate) {
      this.failNextCreate = false;
      const winner = this.insertRepository(input);
      this.credentials.set(winner.id, this.newCredential(winner.id, input.ciphertext, input.encryptionKeyId));
      throw new UniqueViolationError();
    }
    const repository = this.insertRepository(input);
    this.credentials.set(repository.id, this.newCredential(repository.id, input.ciphertext, input.encryptionKeyId));
    return clone(repository);
  }

  async updateOwnedMetadata(userId: string, repoId: string, patch: RepositoryMetadataPatch) {
    const repository = this.repositories.get(repoId);
    if (!repository || repository.user_id !== userId) {
      return null;
    }
    repository.provider_repository_id = patch.providerRepositoryId;
    repository.owner = patch.owner;
    repository.repo_name = patch.repoName;
    repository.repo_url = patch.repoUrl;
    repository.default_branch = patch.defaultBranch;
    repository.is_private = patch.isPrivate;
    repository.updated_at = this.timestamp();
    return clone(repository);
  }

  async updateLastSyncedAt(userId: string, repoId: string, at: string) {
    const repository = this.repositories.get(repoId);
    if (!repository || repository.user_id !== userId) {
      return false;
    }
    repository.last_synced_at = at;
    repository.updated_at = this.timestamp();
    return true;
  }

  async deleteOwned(userId: string, repoId: string) {
    const repository = this.repositories.get(repoId);
    if (!repository || repository.user_id !== userId) {
      return false;
    }
    for (const pullRequest of [...this.pullRequests.values()]) {
      if (pullRequest.repo_id !== repoId) {
        continue;
      }
      for (const audit of [...this.audits.values()]) {
        if (audit.pr_id === pullRequest.id) {
          this.audits.delete(audit.id);
          this.diffs.delete(audit.id);
        }
      }
      this.pullRequests.delete(pullRequest.id);
    }
    this.credentials.delete(repoId);
    this.repositories.delete(repoId);
    return true;
  }

  async getForOwnedRepository(userId: string, repoId: string): Promise<CredentialRecord | null> {
    const repository = this.repositories.get(repoId);
    if (!repository || repository.user_id !== userId) {
      return null;
    }
    const credential = this.credentials.get(repoId);
    return credential ? clone(credential) : null;
  }

  async updateForOwnedRepository(userId: string, repoId: string, ciphertext: string, encryptionKeyId: string) {
    const existing = await this.getForOwnedRepository(userId, repoId);
    if (!existing) {
      return false;
    }
    const credential = this.credentials.get(repoId);
    if (!credential) {
      return false;
    }
    credential.ciphertext = ciphertext;
    credential.encryption_key_id = encryptionKeyId;
    credential.updated_at = this.timestamp();
    return true;
  }

  async upsertSynced(repoId: string, rows: readonly PullRequestSyncRow[]) {
    for (const row of rows) {
      const byNumber = [...this.pullRequests.values()].find(
        (pullRequest) => pullRequest.repo_id === repoId && pullRequest.pr_number === row.pr_number,
      );
      const byProviderId = [...this.pullRequests.values()].find(
        (pullRequest) => pullRequest.repo_id === repoId && pullRequest.provider_pr_id === row.provider_pr_id,
      );
      if (byProviderId && byNumber && byProviderId.id !== byNumber.id) {
        throw new UniqueViolationError();
      }
      if (byProviderId && !byNumber) {
        throw new UniqueViolationError();
      }
      if (byNumber) {
        byNumber.provider_pr_id = row.provider_pr_id;
        byNumber.title = row.title;
        byNumber.author_login = row.author_login;
        byNumber.html_url = row.html_url;
        byNumber.base_branch = row.base_branch;
        byNumber.head_branch = row.head_branch;
        byNumber.head_sha = row.head_sha;
        byNumber.state = row.state;
        byNumber.provider_created_at = row.provider_created_at;
        byNumber.provider_updated_at = row.provider_updated_at;
        byNumber.closed_at = row.closed_at;
        byNumber.merged_at = row.merged_at;
        byNumber.last_synced_at = row.last_synced_at;
        byNumber.updated_at = this.timestamp();
        continue;
      }
      const now = this.timestamp();
      const created: PullRequestRecord = {
        id: randomUUID(),
        repo_id: repoId,
        pr_number: row.pr_number,
        provider_pr_id: row.provider_pr_id,
        title: row.title,
        author_login: row.author_login,
        html_url: row.html_url,
        base_branch: row.base_branch,
        head_branch: row.head_branch,
        head_sha: row.head_sha,
        state: row.state,
        additions: null,
        deletions: null,
        changed_files: null,
        provider_created_at: row.provider_created_at,
        provider_updated_at: row.provider_updated_at,
        closed_at: row.closed_at,
        merged_at: row.merged_at,
        last_synced_at: row.last_synced_at,
        created_at: now,
        updated_at: now,
      };
      this.pullRequests.set(created.id, created);
    }
  }

  async updateFromProvider(userId: string, prId: string, patch: PullRequestDetailPatch) {
    const owned = await this.getPullRequestOwned(userId, prId);
    if (!owned) {
      return null;
    }
    const pullRequest = this.pullRequests.get(prId);
    if (!pullRequest) {
      return null;
    }
    Object.assign(pullRequest, patch, { updated_at: this.timestamp() });
    return clone(pullRequest);
  }

  async countActiveForUser(userId: string) {
    return [...this.audits.values()].filter((audit) => {
      if (audit.status !== 'pending' && audit.status !== 'running') {
        return false;
      }
      return this.ownsPullRequest(userId, audit.pr_id);
    }).length;
  }

  async insertPending(input: {
    userId: string;
    prId: string;
    commitSha: string;
    maxAttempts: number;
    maxActive: number;
  }) {
    if (!this.users.has(input.userId) || !this.ownsPullRequest(input.userId, input.prId)) {
      throw resourceNotFound();
    }
    if ((await this.countActiveForUser(input.userId)) >= input.maxActive) {
      throw new ActiveAuditCapError();
    }
    const conflict = [...this.audits.values()].find(
      (audit) =>
        audit.pr_id === input.prId &&
        audit.commit_sha === input.commitSha &&
        (audit.status === 'pending' || audit.status === 'running'),
    );
    if (conflict) {
      throw new UniqueViolationError();
    }
    const now = this.timestamp();
    const audit: AuditRecord = {
      id: randomUUID(),
      pr_id: input.prId,
      commit_sha: input.commitSha,
      status: 'pending',
      risk_level: null,
      summary: '',
      generated_documentation: '',
      ai_security_flags: [],
      model: null,
      prompt_version: null,
      token_usage: { ...EMPTY_TOKEN_USAGE },
      error_code: null,
      error_message: null,
      diff_bytes: null,
      analyzed_diff_bytes: null,
      files_changed: null,
      diff_truncated: false,
      diff_omitted_files: [],
      attempts: 0,
      max_attempts: input.maxAttempts,
      worker_id: null,
      started_at: null,
      heartbeat_at: null,
      duration_ms: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };
    this.audits.set(audit.id, audit);
    return { id: audit.id, pr_id: audit.pr_id, commit_sha: audit.commit_sha, status: 'pending' as const };
  }

  async findInflightForOwnedPullRequest(userId: string, prId: string, commitSha: string) {
    if (!this.ownsPullRequest(userId, prId)) {
      return null;
    }
    const audit = [...this.audits.values()].find(
      (candidate) =>
        candidate.pr_id === prId &&
        candidate.commit_sha === commitSha &&
        (candidate.status === 'pending' || candidate.status === 'running'),
    );
    return audit ? { id: audit.id, status: audit.status } : null;
  }

  async listForOwnedPullRequest(userId: string, prId: string, page: number, limit: number) {
    if (!this.ownsPullRequest(userId, prId)) {
      return { items: [], total: 0 };
    }
    const items = [...this.audits.values()]
      .filter((audit) => audit.pr_id === prId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id))
      .map((audit) => toListRecord(audit));
    return paginate(items, page, limit);
  }

  async getOwnedAudit(userId: string, auditId: string): Promise<AuditRecord | null> {
    const audit = this.audits.get(auditId);
    if (!audit || !this.ownsPullRequest(userId, audit.pr_id)) {
      return null;
    }
    return clone(audit);
  }

  async claimNext(workerId: string): Promise<ClaimedAudit | null> {
    const next = [...this.audits.values()]
      .filter((audit) => audit.status === 'pending' && audit.attempts < audit.max_attempts)
      .sort((left, right) => left.created_at.localeCompare(right.created_at))[0];
    if (!next) {
      return null;
    }
    const now = this.timestamp();
    next.status = 'running';
    next.started_at = now;
    next.heartbeat_at = now;
    next.worker_id = workerId;
    next.attempts += 1;
    next.updated_at = now;
    return {
      id: next.id,
      pr_id: next.pr_id,
      commit_sha: next.commit_sha,
      status: 'running',
      attempts: next.attempts,
      max_attempts: next.max_attempts,
      worker_id: workerId,
    };
  }

  async recoverStale(staleAfterSeconds: number) {
    const cutoff = Date.now() - staleAfterSeconds * 1000;
    let requeued = 0;
    let exhausted = 0;
    for (const audit of this.audits.values()) {
      if (audit.status !== 'running' || !audit.heartbeat_at) {
        continue;
      }
      if (Date.parse(audit.heartbeat_at) >= cutoff) {
        continue;
      }
      if (audit.attempts < audit.max_attempts) {
        audit.status = 'pending';
        audit.started_at = null;
        audit.heartbeat_at = null;
        audit.worker_id = null;
        requeued += 1;
      } else {
        const completedAt = this.timestamp();
        const startedMs = audit.started_at ? Date.parse(audit.started_at) : Date.parse(completedAt);
        audit.status = 'failed';
        audit.error_code = 'AUDIT_ATTEMPTS_EXHAUSTED';
        audit.error_message = EXHAUSTED_MESSAGE;
        audit.completed_at = completedAt;
        audit.duration_ms = Math.max(0, Date.parse(completedAt) - startedMs);
        exhausted += 1;
      }
      audit.updated_at = this.timestamp();
    }
    return { requeued, exhausted };
  }

  async fencedUpdate(fence: AuditFence, patch: AuditFencedWrite) {
    const audit = this.audits.get(fence.id);
    if (!audit || audit.status !== 'running' || audit.worker_id !== fence.workerId || audit.attempts !== fence.attempts) {
      return false;
    }
    Object.assign(audit, patch, { updated_at: this.timestamp() });
    return true;
  }

  async insertOwnedDiff(fence: AuditFence, rawDiff: string) {
    const audit = this.audits.get(fence.id);
    if (
      !audit ||
      audit.status !== 'running' ||
      audit.worker_id !== fence.workerId ||
      audit.attempts !== fence.attempts
    ) {
      return false;
    }
    if (!this.diffs.has(fence.id)) {
      this.diffs.set(fence.id, rawDiff);
    }
    return true;
  }

  async getProcessingContext(auditId: string): Promise<ProcessingContext | null> {
    const audit = this.audits.get(auditId);
    if (!audit) {
      return null;
    }
    const pullRequest = this.pullRequests.get(audit.pr_id);
    if (!pullRequest) {
      return null;
    }
    const repository = this.repositories.get(pullRequest.repo_id);
    if (!repository) {
      return null;
    }
    return {
      audit: {
        id: audit.id,
        pr_id: audit.pr_id,
        commit_sha: audit.commit_sha,
        status: audit.status,
        attempts: audit.attempts,
        max_attempts: audit.max_attempts,
        worker_id: audit.worker_id,
      },
      pullRequest: {
        id: pullRequest.id,
        pr_number: pullRequest.pr_number,
        head_sha: pullRequest.head_sha,
        title: pullRequest.title,
      },
      repository: {
        id: repository.id,
        user_id: repository.user_id,
        provider: repository.provider,
        owner: repository.owner,
        repo_name: repository.repo_name,
        provider_repository_id: repository.provider_repository_id,
      },
    };
  }

  async getPullRequestOwned(userId: string, prId: string) {
    const pullRequest = this.pullRequests.get(prId);
    if (!pullRequest) {
      return null;
    }
    const repository = this.repositories.get(pullRequest.repo_id);
    if (!repository || repository.user_id !== userId) {
      return null;
    }
    return { pullRequest: clone(pullRequest), repository: clone(repository) };
  }

  async listPullRequestsOwned(userId: string, repoId: string, page: number, limit: number, state?: PullRequestState) {
    const repository = this.repositories.get(repoId);
    if (!repository || repository.user_id !== userId) {
      return { items: [], total: 0 };
    }
    const items = [...this.pullRequests.values()]
      .filter((pullRequest) => pullRequest.repo_id === repoId && (!state || pullRequest.state === state))
      .sort((left, right) => right.pr_number - left.pr_number || right.id.localeCompare(left.id));
    return paginate(items, page, limit);
  }

  private ownsPullRequest(userId: string, prId: string): boolean {
    const pullRequest = this.pullRequests.get(prId);
    if (!pullRequest) {
      return false;
    }
    const repository = this.repositories.get(pullRequest.repo_id);
    return repository?.user_id === userId;
  }

  private assertRepositoryUnique(input: CreateRepositoryInput): void {
    for (const repository of this.repositories.values()) {
      if (repository.user_id !== input.userId) {
        continue;
      }
      const sameUrl = repository.repo_url.toLowerCase() === input.repoUrl.toLowerCase();
      const sameProviderId =
        repository.provider === input.provider && repository.provider_repository_id === input.providerRepositoryId;
      const sameName =
        repository.provider === input.provider &&
        repository.owner.toLowerCase() === input.owner.toLowerCase() &&
        repository.repo_name.toLowerCase() === input.repoName.toLowerCase();
      if (sameUrl || sameProviderId || sameName) {
        throw new UniqueViolationError();
      }
    }
  }

  private insertRepository(input: CreateRepositoryInput): RepositoryRecord {
    const now = this.timestamp();
    const repository: RepositoryRecord = {
      id: input.id,
      user_id: input.userId,
      provider: input.provider,
      provider_repository_id: input.providerRepositoryId,
      owner: input.owner,
      repo_name: input.repoName,
      repo_url: input.repoUrl,
      default_branch: input.defaultBranch,
      is_private: input.isPrivate,
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    };
    this.repositories.set(repository.id, repository);
    return repository;
  }

  private newCredential(repoId: string, ciphertext: string, encryptionKeyId: string): CredentialRecord {
    const now = this.timestamp();
    return {
      repo_id: repoId,
      ciphertext,
      encryption_key_id: encryptionKeyId,
      created_at: now,
      updated_at: now,
    };
  }

  private timestamp(): string {
    this.clock += 1;
    return new Date(this.clock).toISOString();
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function paginate<T>(items: T[], page: number, limit: number): { items: T[]; total: number } {
  const from = (page - 1) * limit;
  return { items: items.slice(from, from + limit).map((item) => clone(item)), total: items.length };
}

function byCreatedThenId(left: { created_at: string; id: string }, right: { created_at: string; id: string }): number {
  return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

export function createMemoryAdapters(db: MemoryDatabase): {
  users: UserData;
  repositories: RepositoryData;
  credentials: CredentialData;
  pullRequests: PullRequestData;
  audits: AuditData;
} {
  return {
    users: {
      ensureUser: (id, email) => db.ensureUser(id, email),
      getById: (id) => db.getById(id),
      updateDisplayName: (id, displayName) => db.updateDisplayName(id, displayName),
    },
    repositories: {
      getOwned: (userId, repoId) => db.getRepositoryOwned(userId, repoId),
      listOwned: (userId, page, limit) => db.listRepositories(userId, page, limit),
      findOwnedByProviderId: (userId, provider, providerRepositoryId) =>
        db.findOwnedByProviderId(userId, provider, providerRepositoryId),
      findOwnedByOwnerName: (userId, provider, owner, repoName) =>
        db.findOwnedByOwnerName(userId, provider, owner, repoName),
      createWithCredential: (input) => db.createWithCredential(input),
      updateOwnedMetadata: (userId, repoId, patch) => db.updateOwnedMetadata(userId, repoId, patch),
      updateLastSyncedAt: (userId, repoId, at) => db.updateLastSyncedAt(userId, repoId, at),
      deleteOwned: (userId, repoId) => db.deleteOwned(userId, repoId),
    },
    credentials: {
      getForOwnedRepository: (userId, repoId) => db.getForOwnedRepository(userId, repoId),
      updateForOwnedRepository: (userId, repoId, ciphertext, keyId) =>
        db.updateForOwnedRepository(userId, repoId, ciphertext, keyId),
    },
    pullRequests: {
      getOwned: (userId, prId) => db.getPullRequestOwned(userId, prId),
      listOwned: (userId, repoId, page, limit, state) =>
        db.listPullRequestsOwned(userId, repoId, page, limit, state),
      upsertSynced: (repoId, rows) => db.upsertSynced(repoId, rows),
      updateFromProvider: (userId, prId, patch) => db.updateFromProvider(userId, prId, patch),
    },
    audits: {
      countActiveForUser: (userId) => db.countActiveForUser(userId),
      insertPending: (input) => db.insertPending(input),
      findInflightForOwnedPullRequest: (userId, prId, commitSha) =>
        db.findInflightForOwnedPullRequest(userId, prId, commitSha),
      listForOwnedPullRequest: (userId, prId, page, limit) =>
        db.listForOwnedPullRequest(userId, prId, page, limit),
      getOwned: (userId, auditId) => db.getOwnedAudit(userId, auditId),
      claimNext: (workerId) => db.claimNext(workerId),
      recoverStale: (staleAfterSeconds) => db.recoverStale(staleAfterSeconds),
      fencedUpdate: (fence, patch) => db.fencedUpdate(fence, patch),
      insertOwnedDiff: (fence, rawDiff) => db.insertOwnedDiff(fence, rawDiff),
      getProcessingContext: (auditId) => db.getProcessingContext(auditId),
    },
  };
}

function toListRecord(audit: AuditRecord): AuditListRecord {
  return {
    id: audit.id,
    pr_id: audit.pr_id,
    commit_sha: audit.commit_sha,
    status: audit.status,
    risk_level: audit.risk_level,
    summary: audit.summary,
    ai_security_flags: audit.ai_security_flags,
    model: audit.model,
    prompt_version: audit.prompt_version,
    diff_truncated: audit.diff_truncated,
    duration_ms: audit.duration_ms,
    created_at: audit.created_at,
    completed_at: audit.completed_at,
    error_code: audit.error_code,
    error_message: audit.error_message,
  };
}
