import type { AppConfig } from '../../config/env.js';
import { GITHUB_JSON_MAX_BYTES, GITHUB_SYNC_PER_PAGE, GITHUB_USER_AGENT } from '../../config/constants.js';
import { AppError } from '../../utils/errors.js';
import { normalizeSha } from '../../utils/sha.js';
import type {
  ProviderCredential,
  ProviderDiff,
  ProviderIdentity,
  ProviderPullRequest,
  ProviderPullRequestDetail,
  ProviderRepository,
  RepositoryCoordinates,
} from '../../types/provider.js';
import type { GitProvider, ListPullRequestsOptions } from '../providers/gitProvider.js';
import { fetchPullRequestDiff } from './diff.js';
import { GitHubClient, hasNextLink, type CredentialSource } from './githubClient.js';
import {
  githubPullDetailSchema,
  githubPullListSchema,
  githubRepositorySchema,
  githubUserSchema,
  type GithubPull,
} from './githubSchemas.js';
import { canonicalRepoUrl, mapGitHubPullRequestState } from './mapping.js';
import { BodyTooLargeError, decodeUtf8, readBodyWithCap } from './readBody.js';

export interface GitHubProviderSettings {
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  maxDiffFetchBytes: number;
  userAgent?: string;
}

export function githubSettingsFromConfig(config: AppConfig): GitHubProviderSettings {
  return {
    baseUrl: config.githubApiBaseUrl,
    apiVersion: config.githubApiVersion,
    timeoutMs: config.githubTimeoutMs,
    maxDiffFetchBytes: config.auditMaxDiffFetchBytes,
    userAgent: GITHUB_USER_AGENT,
  };
}

export class GitHubProvider implements GitProvider {
  constructor(
    private readonly settings: GitHubProviderSettings,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async validateCredentials(cred: ProviderCredential, signal?: AbortSignal): Promise<ProviderIdentity> {
    const client = this.client(cred, 'connect');
    const user = await client.requestJson('/user', githubUserSchema, { signal });
    return {
      provider: 'github',
      accountId: String(user.id),
      login: user.login,
    };
  }

  async getRepository(
    cred: ProviderCredential,
    ref: RepositoryCoordinates,
    signal?: AbortSignal,
  ): Promise<ProviderRepository> {
    const client = this.client(cred, 'connect');
    const repo = await client.requestJson(repoPath(ref), githubRepositorySchema, { signal });
    return {
      provider: 'github',
      providerRepositoryId: String(repo.id),
      owner: repo.owner.login,
      name: repo.name,
      htmlUrl: canonicalRepoUrl(repo.html_url),
      defaultBranch: repo.default_branch,
      isPrivate: repo.private,
    };
  }

  async listPullRequests(
    cred: ProviderCredential,
    repo: RepositoryCoordinates,
    opts: ListPullRequestsOptions,
  ): Promise<{ items: ProviderPullRequest[]; truncated: boolean }> {
    const client = this.client(cred, 'stored');
    const items: ProviderPullRequest[] = [];
    let truncated = false;

    for (let page = 1; page <= opts.maxPages; page += 1) {
      const response = await client.request(`${repoPath(repo)}/pulls`, {
        signal: opts.signal,
        query: {
          state: 'all',
          sort: 'updated',
          direction: 'desc',
          per_page: GITHUB_SYNC_PER_PAGE,
          page,
        },
      });
      if (!response.ok) {
        throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
      }
      const link = response.headers.get('link');
      const bytes = await readBodyWithCap(response, GITHUB_JSON_MAX_BYTES, opts.signal).catch(
        (error: unknown) => {
          if (error instanceof BodyTooLargeError) {
            throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub returned a response that was too large.');
          }
          throw error;
        },
      );
      let json: unknown;
      try {
        json = JSON.parse(decodeUtf8(bytes)) as unknown;
      } catch {
        throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub returned an unexpected response.');
      }
      const parsed = githubPullListSchema.safeParse(json);
      if (!parsed.success) {
        throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub returned an unexpected response.');
      }
      items.push(...parsed.data.map((pull) => toProviderPull(pull)));
      const more = hasNextLink(link);
      if (!more || parsed.data.length === 0) {
        truncated = false;
        break;
      }
      if (page === opts.maxPages) {
        truncated = true;
      }
    }

    return { items, truncated };
  }

  async getPullRequest(
    cred: ProviderCredential,
    repo: RepositoryCoordinates,
    prNumber: number,
    signal?: AbortSignal,
  ): Promise<ProviderPullRequestDetail> {
    const client = this.client(cred, 'stored');
    const pull = await client.requestJson(`${repoPath(repo)}/pulls/${prNumber}`, githubPullDetailSchema, {
      signal,
    });
    return {
      ...toProviderPull(pull),
      additions: pull.additions,
      deletions: pull.deletions,
      changedFiles: pull.changed_files,
    };
  }

  async getPullRequestDiff(
    cred: ProviderCredential,
    repo: RepositoryCoordinates,
    prNumber: number,
    expectedHeadSha: string,
    signal?: AbortSignal,
  ): Promise<ProviderDiff> {
    const client = this.client(cred, 'stored');
    return fetchPullRequestDiff({
      client,
      owner: repo.owner,
      repo: repo.name,
      prNumber,
      expectedHeadSha,
      maxBytes: this.settings.maxDiffFetchBytes,
      signal,
    });
  }

  private client(cred: ProviderCredential, credentialSource: CredentialSource): GitHubClient {
    if (!cred.token.trim()) {
      throw new AppError(422, 'GITHUB_TOKEN_INVALID', 'The GitHub token was rejected.');
    }
    return new GitHubClient({
      baseUrl: this.settings.baseUrl,
      apiVersion: this.settings.apiVersion,
      timeoutMs: this.settings.timeoutMs,
      token: cred.token,
      credentialSource,
      fetchImpl: this.fetchImpl,
      userAgent: this.settings.userAgent ?? GITHUB_USER_AGENT,
    });
  }
}

function repoPath(ref: RepositoryCoordinates): string {
  return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
}

function toProviderPull(pull: GithubPull): ProviderPullRequest {
  const mapped = mapGitHubPullRequestState({
    state: pull.state,
    draft: pull.draft,
    mergedAt: pull.merged_at ?? null,
    closedAt: pull.closed_at ?? null,
    updatedAt: pull.updated_at ?? null,
  });
  const headBranch = pull.head.ref.trim();
  return {
    providerPrId: String(pull.id),
    number: pull.number,
    title: pull.title,
    authorLogin: pull.user?.login ?? null,
    htmlUrl: pull.html_url ?? null,
    baseBranch: pull.base.ref.trim() || 'main',
    headBranch: headBranch.length > 0 ? headBranch : null,
    headSha: normalizeSha(pull.head.sha),
    state: mapped.state,
    createdAt: pull.created_at ?? null,
    updatedAt: pull.updated_at ?? null,
    closedAt: mapped.closedAt,
    mergedAt: mapped.mergedAt,
  };
}
