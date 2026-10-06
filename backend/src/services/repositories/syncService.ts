import type { AppConfig } from '../../config/env.js';
import type { CredentialData, PullRequestData, PullRequestSyncRow, RepositoryData } from '../../data/contracts.js';
import type { EncryptionService } from '../encryption/encryptionService.js';
import type { ProviderFactory } from '../providers/providerFactory.js';
import type { ProviderPullRequest, ProviderPullRequestDetail } from '../../types/provider.js';
import type { AppLogger } from '../../utils/logger.js';
import { auditFailure } from '../audits/auditErrors.js';
import { resourceNotFound } from '../../utils/errors.js';

export interface SyncResult {
  synced: number;
  truncated: boolean;
  last_synced_at: string;
}

export class SyncService {
  constructor(
    private readonly repositories: RepositoryData,
    private readonly credentials: CredentialData,
    private readonly pullRequests: PullRequestData,
    private readonly encryption: EncryptionService,
    private readonly providers: ProviderFactory,
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
  ) {}

  async syncRepositoryPullRequests(userId: string, repoId: string): Promise<SyncResult> {
    const repository = await this.repositories.getOwned(userId, repoId);
    if (!repository) {
      throw resourceNotFound();
    }
    const token = await this.decryptToken(userId, repository.id);
    const provider = this.providers.getProvider(repository.provider);
    const listed = await provider.listPullRequests(
      { token },
      { owner: repository.owner, name: repository.repo_name },
      { maxPages: this.config.githubSyncMaxPages },
    );
    const syncedAt = new Date().toISOString();
    const rows = listed.items.map((item) => toSyncRow(item, syncedAt));
    await this.pullRequests.upsertSynced(repository.id, rows);
    const stamped = await this.repositories.updateLastSyncedAt(userId, repository.id, syncedAt);
    if (!stamped) {
      throw resourceNotFound();
    }
    this.logger.info(
      { user_id: userId, repo_id: repository.id, synced: rows.length, truncated: listed.truncated },
      'repository synchronized',
    );
    return { synced: rows.length, truncated: listed.truncated, last_synced_at: syncedAt };
  }

  async decryptToken(userId: string, repoId: string): Promise<string> {
    const credential = await this.credentials.getForOwnedRepository(userId, repoId);
    if (!credential) {
      throw auditFailure('REPOSITORY_ACCESS_LOST', 409);
    }
    return this.encryption.decrypt(credential.ciphertext, credential.encryption_key_id, { repoId });
  }
}

export function toSyncRow(pr: ProviderPullRequest, syncedAt: string): PullRequestSyncRow {
  return {
    provider_pr_id: pr.providerPrId,
    pr_number: pr.number,
    title: pr.title,
    author_login: pr.authorLogin,
    html_url: pr.htmlUrl,
    base_branch: pr.baseBranch,
    head_branch: pr.headBranch,
    head_sha: pr.headSha,
    state: pr.state,
    provider_created_at: pr.createdAt,
    provider_updated_at: pr.updatedAt,
    closed_at: pr.closedAt,
    merged_at: pr.mergedAt,
    last_synced_at: syncedAt,
  };
}

export function toDetailPatch(pr: ProviderPullRequestDetail, syncedAt: string) {
  return {
    ...toSyncRow(pr, syncedAt),
    additions: pr.additions,
    deletions: pr.deletions,
    changed_files: pr.changedFiles,
  };
}
