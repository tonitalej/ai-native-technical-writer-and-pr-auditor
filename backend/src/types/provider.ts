import type { GitProviderName, PullRequestState } from './domain.js';
import type { OmittedFile } from '../services/audits/diffSelection.js';

export interface ProviderCredential {
  token: string;
}

export interface ProviderIdentity {
  provider: GitProviderName;
  accountId: string;
  login: string;
}

export interface ProviderRepository {
  provider: GitProviderName;
  providerRepositoryId: string;
  owner: string;
  name: string;
  htmlUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export interface ProviderPullRequest {
  providerPrId: string;
  number: number;
  title: string;
  authorLogin: string | null;
  htmlUrl: string | null;
  baseBranch: string;
  headBranch: string | null;
  headSha: string;
  state: PullRequestState;
  createdAt: string | null;
  updatedAt: string | null;
  closedAt: string | null;
  mergedAt: string | null;
}

export interface ProviderPullRequestDetail extends ProviderPullRequest {
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface ProviderDiff {
  diff: string;
  filesChanged: number;
  bytes: number;
  omittedFiles: OmittedFile[];
  viaFallback: boolean;
  truncated: boolean;
}

export interface RepositoryCoordinates {
  owner: string;
  name: string;
}
