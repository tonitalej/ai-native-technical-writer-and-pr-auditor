import type { OwnedPullRequest, PullRequestData, RepositoryData } from '../../data/contracts.js';
import type { PullRequestRecord, PullRequestState } from '../../types/domain.js';
import { resourceNotFound } from '../../utils/errors.js';

export class PullRequestService {
  constructor(
    private readonly repositories: RepositoryData,
    private readonly pullRequests: PullRequestData,
  ) {}

  async list(
    userId: string,
    repoId: string,
    page: number,
    limit: number,
    state?: PullRequestState,
  ): Promise<{ items: PullRequestRecord[]; total: number }> {
    const repository = await this.repositories.getOwned(userId, repoId);
    if (!repository) {
      throw resourceNotFound();
    }
    return this.pullRequests.listOwned(userId, repoId, page, limit, state);
  }

  async get(userId: string, prId: string): Promise<OwnedPullRequest> {
    const owned = await this.pullRequests.getOwned(userId, prId);
    if (!owned) {
      throw resourceNotFound();
    }
    return owned;
  }
}
