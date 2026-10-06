import { AppError } from '../../src/utils/errors.js';
import { normalizeSha } from '../../src/utils/sha.js';
import type { GitProvider, ListPullRequestsOptions } from '../../src/services/providers/gitProvider.js';
import type {
  ProviderCredential,
  ProviderDiff,
  ProviderIdentity,
  ProviderPullRequestDetail,
  ProviderRepository,
  RepositoryCoordinates,
} from '../../src/types/provider.js';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);

export function samplePull(overrides: Partial<ProviderPullRequestDetail> = {}): ProviderPullRequestDetail {
  return {
    providerPrId: '501',
    number: 7,
    title: 'Add greeting',
    authorLogin: 'octocat',
    htmlUrl: 'https://github.com/octocat/hello/pull/7',
    baseBranch: 'main',
    headBranch: 'feature',
    headSha: SHA_A,
    state: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    closedAt: null,
    mergedAt: null,
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    ...overrides,
  };
}

export const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
-old
+const greeting = "hello";
+const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
`;

export class FakeGitHub implements GitProvider {
  identity: ProviderIdentity = { provider: 'github', accountId: '1', login: 'octocat' };
  repository: ProviderRepository = {
    provider: 'github',
    providerRepositoryId: '100',
    owner: 'octocat',
    name: 'hello',
    htmlUrl: 'https://github.com/octocat/hello',
    defaultBranch: 'main',
    isPrivate: true,
  };
  pulls: ProviderPullRequestDetail[] = [samplePull()];
  diffText = SAMPLE_DIFF;
  headShas: string[] = [];
  truncated = false;
  invalidToken = 'bad-token';
  missingRepository = false;
  onGetPullRequest: (() => void) | undefined;
  prCalls = 0;
  diffCalls = 0;

  async validateCredentials(cred: ProviderCredential): Promise<ProviderIdentity> {
    if (cred.token === this.invalidToken) {
      throw new AppError(422, 'GITHUB_TOKEN_INVALID', 'The GitHub token was rejected.');
    }
    return this.identity;
  }

  async getRepository(_cred: ProviderCredential, _ref: RepositoryCoordinates): Promise<ProviderRepository> {
    if (this.missingRepository) {
      throw new AppError(404, 'PROVIDER_RESOURCE_NOT_FOUND', 'The GitHub resource was not found.');
    }
    return this.repository;
  }

  async listPullRequests(
    _cred: ProviderCredential,
    _repo: RepositoryCoordinates,
    _opts: ListPullRequestsOptions,
  ) {
    return { items: this.pulls, truncated: this.truncated };
  }

  async getPullRequest(): Promise<ProviderPullRequestDetail> {
    this.prCalls += 1;
    this.onGetPullRequest?.();
    const base = this.pulls[0];
    if (!base) {
      throw new AppError(404, 'PROVIDER_RESOURCE_NOT_FOUND', 'The GitHub resource was not found.');
    }
    const headSha = this.headShas.shift() ?? base.headSha;
    return { ...base, headSha };
  }

  async getPullRequestDiff(
    _cred: ProviderCredential,
    _repo: RepositoryCoordinates,
    _prNumber: number,
    expectedHeadSha: string,
  ): Promise<ProviderDiff> {
    this.diffCalls += 1;
    normalizeSha(expectedHeadSha);
    return {
      diff: this.diffText,
      filesChanged: 1,
      bytes: Buffer.byteLength(this.diffText),
      omittedFiles: [],
      viaFallback: false,
      truncated: false,
    };
  }
}
