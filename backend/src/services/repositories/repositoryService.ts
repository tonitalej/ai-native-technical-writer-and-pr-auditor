import { randomUUID } from 'node:crypto';

import type { CredentialData, RepositoryData } from '../../data/contracts.js';
import type { EncryptionService } from '../encryption/encryptionService.js';
import type { ProviderFactory } from '../providers/providerFactory.js';
import type { RepositoryRecord } from '../../types/domain.js';
import type { AppLogger } from '../../utils/logger.js';
import { AppError, isUniqueViolation, resourceNotFound } from '../../utils/errors.js';
import { parseRepositoryRef } from '../github/mapping.js';

export interface ConnectRepositoryResult {
  repository: RepositoryRecord;
  created: boolean;
}

export class RepositoryService {
  constructor(
    private readonly repositories: RepositoryData,
    private readonly credentials: CredentialData,
    private readonly encryption: EncryptionService,
    private readonly providers: ProviderFactory,
    private readonly logger: AppLogger,
  ) {}

  async connect(
    userId: string,
    input: { repository: string; token: string },
  ): Promise<ConnectRepositoryResult> {
    const ref = parseRepositoryRef(input.repository);
    const provider = this.providers.getProvider('github');
    const credential = { token: input.token };
    await provider.validateCredentials(credential);
    const remote = await provider.getRepository(credential, { owner: ref.owner, name: ref.name });

    const existing =
      (await this.repositories.findOwnedByProviderId(userId, 'github', remote.providerRepositoryId)) ??
      (await this.repositories.findOwnedByOwnerName(userId, 'github', remote.owner, remote.name));

    if (existing) {
      const repository = await this.rotate(userId, existing.id, input.token, remote);
      return { repository, created: false };
    }

    const id = randomUUID();
    const encrypted = this.encryption.encrypt(input.token, { repoId: id });
    try {
      const created = await this.repositories.createWithCredential({
        id,
        userId,
        provider: 'github',
        providerRepositoryId: remote.providerRepositoryId,
        owner: remote.owner,
        repoName: remote.name,
        repoUrl: remote.htmlUrl,
        defaultBranch: remote.defaultBranch,
        isPrivate: remote.isPrivate,
        ciphertext: encrypted.ciphertext,
        encryptionKeyId: encrypted.keyId,
      });
      this.logger.info(
        { user_id: userId, repo_id: created.id, provider_repository_id: created.provider_repository_id },
        'repository connected',
      );
      return { repository: created, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const raced =
        (await this.repositories.findOwnedByProviderId(userId, 'github', remote.providerRepositoryId)) ??
        (await this.repositories.findOwnedByOwnerName(userId, 'github', remote.owner, remote.name));
      if (!raced) {
        throw new AppError(409, 'CONFLICT', 'A repository with this identity already exists.');
      }
      const repository = await this.rotate(userId, raced.id, input.token, remote);
      return { repository, created: false };
    }
  }

  list(userId: string, page: number, limit: number) {
    return this.repositories.listOwned(userId, page, limit);
  }

  async get(userId: string, repoId: string): Promise<RepositoryRecord> {
    const repository = await this.repositories.getOwned(userId, repoId);
    if (!repository) {
      throw resourceNotFound();
    }
    return repository;
  }

  async delete(userId: string, repoId: string): Promise<void> {
    const deleted = await this.repositories.deleteOwned(userId, repoId);
    if (!deleted) {
      throw resourceNotFound();
    }
    this.logger.info({ user_id: userId, repo_id: repoId }, 'repository deleted');
  }

  private async rotate(
    userId: string,
    repoId: string,
    token: string,
    remote: {
      providerRepositoryId: string;
      owner: string;
      name: string;
      htmlUrl: string;
      defaultBranch: string;
      isPrivate: boolean;
    },
  ): Promise<RepositoryRecord> {
    const encrypted = this.encryption.encrypt(token, { repoId });
    const updatedCredential = await this.credentials.updateForOwnedRepository(
      userId,
      repoId,
      encrypted.ciphertext,
      encrypted.keyId,
    );
    if (!updatedCredential) {
      throw resourceNotFound();
    }
    const repository = await this.repositories.updateOwnedMetadata(userId, repoId, {
      providerRepositoryId: remote.providerRepositoryId,
      owner: remote.owner,
      repoName: remote.name,
      repoUrl: remote.htmlUrl,
      defaultBranch: remote.defaultBranch,
      isPrivate: remote.isPrivate,
    });
    if (!repository) {
      throw resourceNotFound();
    }
    this.logger.info({ user_id: userId, repo_id: repoId }, 'repository credential rotated');
    return repository;
  }
}
