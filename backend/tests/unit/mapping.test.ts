import { describe, expect, it } from 'vitest';

import { mapGitHubPullRequestState, parseRepositoryRef } from '../../src/services/github/mapping.js';
import { classifyGitHubStatus } from '../../src/services/github/githubClient.js';

const updated = '2026-02-01T00:00:00.000Z';
const closed = '2026-02-02T00:00:00.000Z';
const merged = '2026-02-03T00:00:00.000Z';

describe('pull request state mapping', () => {
  it('maps open, draft, closed, merged, and draft-and-closed', () => {
    expect(
      mapGitHubPullRequestState({ state: 'open', draft: false, mergedAt: null, closedAt: null, updatedAt: updated }),
    ).toMatchObject({ state: 'open', closedAt: null, mergedAt: null });
    expect(
      mapGitHubPullRequestState({ state: 'open', draft: true, mergedAt: null, closedAt: closed, updatedAt: updated }),
    ).toMatchObject({ state: 'draft', closedAt: null, mergedAt: null });
    expect(
      mapGitHubPullRequestState({ state: 'closed', draft: false, mergedAt: null, closedAt: closed, updatedAt: updated }),
    ).toMatchObject({ state: 'closed', closedAt: closed, mergedAt: null });
    expect(
      mapGitHubPullRequestState({ state: 'closed', draft: false, mergedAt: merged, closedAt: closed, updatedAt: updated }),
    ).toMatchObject({ state: 'merged', closedAt: closed, mergedAt: merged });
    expect(
      mapGitHubPullRequestState({ state: 'closed', draft: true, mergedAt: null, closedAt: closed, updatedAt: updated }),
    ).toMatchObject({ state: 'closed', mergedAt: null });
  });

  it('parses owner/name and github URLs', () => {
    expect(parseRepositoryRef('Octo/Hello')).toEqual({ owner: 'Octo', name: 'Hello' });
    expect(parseRepositoryRef('https://github.com/Octo/Hello.git')).toEqual({ owner: 'Octo', name: 'Hello' });
    expect(() => parseRepositoryRef('not a repo')).toThrow(/GitHub/);
  });
});

describe('github status mapping', () => {
  it('never turns upstream 401 or 403 into our 401 or 403', () => {
    const connect = classifyGitHubStatus({
      status: 401,
      rateLimitRemaining: '10',
      retryAfterSeconds: null,
      bodySample: '',
      credentialSource: 'connect',
    });
    const stored = classifyGitHubStatus({
      status: 401,
      rateLimitRemaining: '10',
      retryAfterSeconds: null,
      bodySample: '',
      credentialSource: 'stored',
    });
    const permission = classifyGitHubStatus({
      status: 403,
      rateLimitRemaining: '10',
      retryAfterSeconds: null,
      bodySample: 'Resource not accessible by integration',
      credentialSource: 'stored',
    });
    const limited = classifyGitHubStatus({
      status: 403,
      rateLimitRemaining: '0',
      retryAfterSeconds: 30,
      bodySample: '',
      credentialSource: 'stored',
    });
    expect(connect.error.statusCode).toBe(422);
    expect(connect.error.code).toBe('GITHUB_TOKEN_INVALID');
    expect(stored.error.statusCode).toBe(409);
    expect(stored.error.code).toBe('PROVIDER_CREDENTIAL_INVALID');
    expect(permission.error.statusCode).toBe(409);
    expect(permission.error.code).toBe('PROVIDER_PERMISSION_DENIED');
    expect(limited.error.statusCode).toBe(429);
    expect(limited.error.code).toBe('PROVIDER_RATE_LIMITED');
    expect(limited.retryable).toBe(false);
    for (const result of [connect, stored, permission, limited]) {
      expect(result.error.statusCode).not.toBe(401);
      expect(result.error.statusCode).not.toBe(403);
    }
  });

  it('retries a short rate-limit window and does not retry 410', () => {
    const retry = classifyGitHubStatus({
      status: 429,
      rateLimitRemaining: '0',
      retryAfterSeconds: 2,
      bodySample: 'rate limit',
      credentialSource: 'stored',
    });
    const gone = classifyGitHubStatus({
      status: 410,
      rateLimitRemaining: null,
      retryAfterSeconds: null,
      bodySample: 'gone',
      credentialSource: 'stored',
    });
    expect(retry.retryable).toBe(true);
    expect(retry.waitMs).toBe(2000);
    expect(gone.retryable).toBe(false);
    expect(gone.error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});
