import type {
  ProviderCredential,
  ProviderDiff,
  ProviderIdentity,
  ProviderPullRequest,
  ProviderPullRequestDetail,
  ProviderRepository,
  RepositoryCoordinates,
} from '../../types/provider.js';

export interface ListPullRequestsOptions {
  maxPages: number;
  signal?: AbortSignal;
}

/**
 * Provider-neutral Git host. V1 implements GitHub only.
 * `signal` is optional so an audit deadline can cancel in-flight calls.
 */
export interface GitProvider {
  validateCredentials(cred: ProviderCredential, signal?: AbortSignal): Promise<ProviderIdentity>;
  getRepository(
    cred: ProviderCredential,
    ref: RepositoryCoordinates,
    signal?: AbortSignal,
  ): Promise<ProviderRepository>;
  listPullRequests(
    cred: ProviderCredential,
    repo: RepositoryCoordinates,
    opts: ListPullRequestsOptions,
  ): Promise<{ items: ProviderPullRequest[]; truncated: boolean }>;
  getPullRequest(
    cred: ProviderCredential,
    repo: RepositoryCoordinates,
    prNumber: number,
    signal?: AbortSignal,
  ): Promise<ProviderPullRequestDetail>;
  getPullRequestDiff(
    cred: ProviderCredential,
    repo: RepositoryCoordinates,
    prNumber: number,
    expectedHeadSha: string,
    signal?: AbortSignal,
  ): Promise<ProviderDiff>;
}
