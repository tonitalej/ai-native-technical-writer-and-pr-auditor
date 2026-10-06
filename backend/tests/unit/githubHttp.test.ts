import { describe, expect, it } from 'vitest';

import { GitHubClient } from '../../src/services/github/githubClient.js';
import { fetchPullRequestDiff } from '../../src/services/github/diff.js';
import { githubUserSchema } from '../../src/services/github/githubSchemas.js';
import { AppError } from '../../src/utils/errors.js';

const SHA = 'a'.repeat(40);

function client(fetchImpl: typeof fetch, source: 'connect' | 'stored' = 'stored'): GitHubClient {
  return new GitHubClient({
    baseUrl: 'https://api.github.com',
    apiVersion: '2026-03-10',
    timeoutMs: 1000,
    token: 'ghp_testtokenvalue012345678901234567890',
    credentialSource: source,
    fetchImpl,
  });
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

describe('github client', () => {
  it('retries 502 once and does not retry 410', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(502, { message: 'bad gateway' });
      }
      return jsonResponse(200, { id: 1, login: 'octocat' });
    };
    const user = await client(fetchImpl, 'connect').requestJson('/user', githubUserSchema);
    expect(user.login).toBe('octocat');
    expect(calls).toBe(2);

    let goneCalls = 0;
    const goneFetch: typeof fetch = async () => {
      goneCalls += 1;
      return jsonResponse(410, { message: 'gone' });
    };
    await expect(client(goneFetch).requestJson('/user', githubUserSchema)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      statusCode: 502,
    });
    expect(goneCalls).toBe(1);
  });

  it('maps a timeout to provider unavailable', async () => {
    const fetchImpl: typeof fetch = async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    };
    await expect(client(fetchImpl).requestJson('/user', githubUserSchema)).rejects.toMatchObject({
      statusCode: 502,
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('pull request diff fetch', () => {
  it('reads the diff media type and stops at the byte cap', async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('accept')).toBe('application/vnd.github.diff');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from('x'.repeat(50)));
          controller.enqueue(Buffer.from('y'.repeat(50)));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };
    await expect(
      fetchPullRequestDiff({
        client: client(fetchImpl),
        owner: 'octo',
        repo: 'hello',
        prNumber: 1,
        expectedHeadSha: SHA,
        maxBytes: 60,
      }),
    ).rejects.toBeInstanceOf(AppError);
    await expect(
      fetchPullRequestDiff({
        client: client(fetchImpl),
        owner: 'octo',
        repo: 'hello',
        prNumber: 1,
        expectedHeadSha: SHA,
        maxBytes: 60,
      }),
    ).rejects.toMatchObject({ code: 'DIFF_TOO_LARGE' });
  });

  it('falls back to the files API when GitHub refuses the diff', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/pulls/4')) {
        return new Response('diff too large', { status: 406 });
      }
      return jsonResponse(200, [
        {
          filename: 'src/app.ts',
          status: 'modified',
          additions: 1,
          deletions: 0,
          changes: 1,
          patch: '@@ -1 +1 @@\n+hello\n',
        },
        {
          filename: 'assets/logo.png',
          status: 'changed',
          additions: 0,
          deletions: 0,
          changes: 0,
        },
      ]);
    };
    const diff = await fetchPullRequestDiff({
      client: client(fetchImpl),
      owner: 'octo',
      repo: 'hello',
      prNumber: 4,
      expectedHeadSha: SHA,
      maxBytes: 100_000,
    });
    expect(diff.viaFallback).toBe(true);
    expect(diff.diff).toContain('diff --git a/src/app.ts b/src/app.ts');
    expect(diff.omittedFiles).toEqual([{ path: 'assets/logo.png', reason: 'binary' }]);
    expect(diff.truncated).toBe(true);
    expect(calls.some((url) => url.includes('/files'))).toBe(true);
  });

  it('rejects an empty diff', async () => {
    const fetchImpl: typeof fetch = async () => new Response('   ', { status: 200 });
    await expect(
      fetchPullRequestDiff({
        client: client(fetchImpl),
        owner: 'octo',
        repo: 'hello',
        prNumber: 1,
        expectedHeadSha: SHA,
        maxBytes: 1000,
      }),
    ).rejects.toMatchObject({ code: 'DIFF_EMPTY' });
  });
});
