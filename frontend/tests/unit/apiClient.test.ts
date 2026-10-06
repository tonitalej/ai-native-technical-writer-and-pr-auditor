import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { setAuthBridge } from '../../src/api/authBridge';
import { apiFetch, parseRetryAfter, setApiBase } from '../../src/api/client';
import { ApiError } from '../../src/api/errors';
import { userSchema } from '../../src/types/api';
import { user } from '../fixtures';
import { server } from '../mocks/server';

const API = 'http://localhost:3000';

function bridge(overrides?: { refresh?: () => Promise<string | null>; signOut?: () => Promise<void> }) {
  const calls = { refresh: 0, signOut: 0 };
  setApiBase(API);
  setAuthBridge({
    getAccessToken: async () => 'test-access-token',
    refreshAccessToken: async () => {
      calls.refresh += 1;
      return overrides?.refresh ? overrides.refresh() : 'refreshed-token';
    },
    signOut: async () => {
      calls.signOut += 1;
      await overrides?.signOut?.();
    },
  });
  return calls;
}

describe('api client', () => {
  it('sends the bearer token, parses the envelope, and keeps the request id', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${API}/api/me`, ({ request }) => {
        seen.push(request.headers.get('Authorization') ?? '');
        return HttpResponse.json({ data: user }, { headers: { 'X-Request-Id': 'req-ok' } });
      }),
    );
    bridge();
    const result = await apiFetch('/api/me', userSchema);
    expect(seen).toEqual(['Bearer test-access-token']);
    expect(result.data.email).toBe('ada@example.com');
    expect(result.requestId).toBe('req-ok');
  });

  it('accepts 204 with no body', async () => {
    server.use(http.delete(`${API}/api/repositories/11111111-1111-4111-8111-111111111111`, () => new HttpResponse(null, { status: 204, headers: { 'X-Request-Id': 'req-204' } })));
    bridge();
    const result = await apiFetch('/api/repositories/11111111-1111-4111-8111-111111111111', z.undefined(), { method: 'DELETE' });
    expect(result.status).toBe(204);
    expect(result.requestId).toBe('req-204');
  });

  it('maps an error body and captures the request id', async () => {
    server.use(
      http.post(`${API}/api/repositories`, () =>
        HttpResponse.json(
          { error: { code: 'GITHUB_TOKEN_INVALID', message: 'Rejected.' } },
          { status: 422, headers: { 'X-Request-Id': 'req-err' } },
        ),
      ),
    );
    const calls = bridge();
    await expect(apiFetch('/api/repositories', userSchema, { method: 'POST', body: { repository: 'a/b', token: 'x' } })).rejects.toMatchObject({
      status: 422,
      code: 'GITHUB_TOKEN_INVALID',
      requestId: 'req-err',
    });
    expect(calls.signOut).toBe(0);
  });

  it('refreshes once and retries after 401, then signs out if the retry is still unauthorized', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/api/me`, () => {
        attempts += 1;
        return HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } },
          { status: 401, headers: { 'X-Request-Id': `req-${attempts}` } },
        );
      }),
    );
    const calls = bridge();
    await expect(apiFetch('/api/me', userSchema)).rejects.toBeInstanceOf(ApiError);
    expect(attempts).toBe(2);
    expect(calls.refresh).toBe(1);
    expect(calls.signOut).toBe(1);
  });

  it('retries with the refreshed token after one 401', async () => {
    let attempts = 0;
    server.use(
      http.get(`${API}/api/me`, ({ request }) => {
        attempts += 1;
        if (request.headers.get('Authorization') === 'Bearer refreshed-token') {
          return HttpResponse.json({ data: user }, { headers: { 'X-Request-Id': 'req-retry' } });
        }
        return HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } },
          { status: 401, headers: { 'X-Request-Id': 'req-stale' } },
        );
      }),
    );
    const calls = bridge();
    const result = await apiFetch('/api/me', userSchema);
    expect(result.requestId).toBe('req-retry');
    expect(attempts).toBe(2);
    expect(calls.signOut).toBe(0);
  });

  it('does not sign out on 409', async () => {
    server.use(
      http.post(`${API}/api/pull-requests/33333333-3333-4333-8333-333333333333/audits`, () =>
        HttpResponse.json({ error: { code: 'PROVIDER_PERMISSION_DENIED', message: 'No.' } }, { status: 409, headers: { 'X-Request-Id': 'req-409' } }),
      ),
    );
    const calls = bridge();
    await expect(
      apiFetch('/api/pull-requests/33333333-3333-4333-8333-333333333333/audits', z.object({ id: z.string() }), { method: 'POST' }),
    ).rejects.toMatchObject({ status: 409, code: 'PROVIDER_PERMISSION_DENIED' });
    expect(calls.signOut).toBe(0);
  });

  it('parses Retry-After seconds and HTTP dates', () => {
    expect(parseRetryAfter('12')).toBe(12);
    const future = new Date(Date.now() + 30_000).toUTCString();
    expect(parseRetryAfter(future)).toBeGreaterThan(0);
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it('keeps Retry-After on the thrown error', async () => {
    server.use(
      http.get(`${API}/api/me`, () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
          { status: 429, headers: { 'Retry-After': '15', 'X-Request-Id': 'req-rate' } },
        ),
      ),
    );
    bridge();
    await expect(apiFetch('/api/me', userSchema)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 15, requestId: 'req-rate' });
  });
});
