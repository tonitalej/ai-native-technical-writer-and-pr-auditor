import type { AppConfig } from '../../config/env.js';
import type { AuditData, PullRequestData } from '../../data/contracts.js';
import type { AuditListRecord } from '../../data/contracts.js';
import type { AuditRecord } from '../../types/domain.js';
import type { AppLogger } from '../../utils/logger.js';
import { ActiveAuditCapError, AppError, isUniqueViolation, resourceNotFound } from '../../utils/errors.js';
import { normalizeSha } from '../../utils/sha.js';
import type { ProviderFactory } from '../providers/providerFactory.js';
import { SyncService, toDetailPatch } from '../repositories/syncService.js';

export interface CreatedAudit {
  id: string;
  pr_id: string;
  commit_sha: string;
  status: 'pending';
}

export class AuditService {
  constructor(
    private readonly audits: AuditData,
    private readonly pullRequests: PullRequestData,
    private readonly sync: SyncService,
    private readonly providers: ProviderFactory,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly onAuditQueued?: () => void,
  ) {}

  async create(userId: string, prId: string): Promise<CreatedAudit> {
    const owned = await this.pullRequests.getOwned(userId, prId);
    if (!owned) {
      throw resourceNotFound();
    }

    const active = await this.audits.countActiveForUser(userId);
    if (active >= this.config.maxActiveAuditsPerUser) {
      throw new ActiveAuditCapError();
    }

    const token = await this.sync.decryptToken(userId, owned.repository.id);
    const provider = this.providers.getProvider(owned.repository.provider);
    const fresh = await provider.getPullRequest(
      { token },
      { owner: owned.repository.owner, name: owned.repository.repo_name },
      owned.pullRequest.pr_number,
    );
    const commitSha = normalizeSha(fresh.headSha);
    const syncedAt = new Date().toISOString();
    const updated = await this.pullRequests.updateFromProvider(
      userId,
      prId,
      toDetailPatch(fresh, syncedAt),
    );
    if (!updated) {
      throw resourceNotFound();
    }

    try {
      const audit = await this.audits.insertPending({
        userId,
        prId,
        commitSha,
        maxAttempts: this.config.auditMaxAttempts,
        maxActive: this.config.maxActiveAuditsPerUser,
      });
      this.logger.info({ user_id: userId, audit_id: audit.id, pr_id: prId }, 'audit queued');
      this.onAuditQueued?.();
      return audit;
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await this.audits.findInflightForOwnedPullRequest(userId, prId, commitSha);
      throw new AppError(
        409,
        'AUDIT_ALREADY_ACTIVE',
        'An audit is already in progress for this pull request commit.',
        existing ? { audit_id: existing.id, status: existing.status } : undefined,
      );
    }
  }

  async list(userId: string, prId: string, page: number, limit: number): Promise<{
    items: AuditListRecord[];
    total: number;
  }> {
    const owned = await this.pullRequests.getOwned(userId, prId);
    if (!owned) {
      throw resourceNotFound();
    }
    return this.audits.listForOwnedPullRequest(userId, prId, page, limit);
  }

  async get(userId: string, auditId: string): Promise<AuditRecord> {
    const audit = await this.audits.getOwned(userId, auditId);
    if (!audit) {
      throw resourceNotFound();
    }
    return audit;
  }
}
