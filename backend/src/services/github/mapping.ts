import { AppError } from '../../utils/errors.js';

export type ProviderPrState = 'open' | 'draft' | 'closed' | 'merged';

export interface GitHubStateInput {
  state: 'open' | 'closed';
  draft: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string | null;
}

export interface MappedPullRequestState {
  state: ProviderPrState;
  closedAt: string | null;
  mergedAt: string | null;
}

/**
 * GitHub's list payload has `state`, `draft`, and `merged_at` (no `merged` boolean).
 * Open pull requests never persist close/merge timestamps, even if a payload contains them,
 * so the database consistency checks can pass.
 * A closed pull request with a missing `closed_at` falls back to `merged_at`, then `updated_at`.
 */
export function mapGitHubPullRequestState(input: GitHubStateInput): MappedPullRequestState {
  if (input.state === 'open') {
    return {
      state: input.draft ? 'draft' : 'open',
      closedAt: null,
      mergedAt: null,
    };
  }

  if (input.mergedAt) {
    return {
      state: 'merged',
      mergedAt: input.mergedAt,
      closedAt: input.closedAt ?? input.mergedAt,
    };
  }

  return {
    state: 'closed',
    mergedAt: null,
    closedAt: input.closedAt ?? input.updatedAt ?? new Date().toISOString(),
  };
}

export function canonicalRepoUrl(htmlUrl: string): string {
  const url = new URL(htmlUrl);
  const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

const SHORT_REF = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const GITHUB_URL_REF =
  /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

export interface ParsedRepositoryRef {
  owner: string;
  name: string;
}

export function parseRepositoryRef(input: string): ParsedRepositoryRef {
  const trimmed = input.trim();
  const shortMatch = SHORT_REF.exec(trimmed);
  const urlMatch = GITHUB_URL_REF.exec(trimmed);
  const match = shortMatch ?? urlMatch;
  const owner = match?.[1];
  const name = match?.[2];
  if (!owner || !name || owner === '.' || owner === '..' || name === '.' || name === '..') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Repository must be a GitHub owner/name or a github.com repository URL.',
    );
  }
  return { owner, name };
}
