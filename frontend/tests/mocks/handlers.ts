import { http, HttpResponse } from 'msw';

import type { Audit, PullRequest, Repository } from '../../src/types/api';
import { auditListItem, completedAudit, pullRequest, repository, user } from '../fixtures';

const API = 'http://localhost:3000';

export const db = {
  repos: [repository()] as Repository[],
  pulls: [pullRequest()] as PullRequest[],
  audit: completedAudit() as Audit,
  list: [auditListItem()],
  connectStatus: 201 as 200 | 201,
  startStatus: 202,
  startBody: {
    id: '44444444-4444-4444-8444-444444444444',
    pr_id: '33333333-3333-4333-8333-333333333333',
    commit_sha: 'a'.repeat(40),
    status: 'pending' as const,
  },
  sync: { synced: 2, truncated: false, last_synced_at: '2026-01-04T00:00:00.000Z' },
};

export function resetDb(): void {
  db.repos = [repository()];
  db.pulls = [pullRequest()];
  db.audit = completedAudit();
  db.list = [auditListItem()];
  db.connectStatus = 201;
  db.startStatus = 202;
  db.sync = { synced: 2, truncated: false, last_synced_at: '2026-01-04T00:00:00.000Z' };
}

function json(body: object, status = 200, requestId = 'req-test') {
  return HttpResponse.json(body, { status, headers: { 'X-Request-Id': requestId } });
}

export const handlers = [
  http.get(`${API}/api/me`, () => json({ data: user })),
  http.patch(`${API}/api/me`, async ({ request }) => {
    const body = (await request.json()) as { display_name: string | null };
    return json({ data: { ...user, display_name: body.display_name } });
  }),
  http.get(`${API}/api/repositories`, ({ request }) => {
    const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
    const start = (page - 1) * 20;
    return json({
      data: db.repos.slice(start, start + 20),
      pagination: { page, limit: 20, total: db.repos.length },
    });
  }),
  http.post(`${API}/api/repositories`, async ({ request }) => {
    const body = (await request.json()) as { repository: string; token: string };
    if (body.token === 'bad-token') {
      return json({ error: { code: 'GITHUB_TOKEN_INVALID', message: 'The GitHub token was rejected.' } }, 422, 'req-token');
    }
    const created = repository({ id: '55555555-5555-4555-8555-555555555555' });
    if (db.connectStatus === 201) {
      db.repos = [created, ...db.repos];
    }
    return json({ data: db.connectStatus === 201 ? created : db.repos[0] }, db.connectStatus, 'req-connect');
  }),
  http.get(`${API}/api/repositories/:repoId`, ({ params }) => {
    const found = db.repos.find((item) => item.id === params.repoId);
    if (!found) {
      return json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.' } }, 404);
    }
    return json({ data: found });
  }),
  http.delete(`${API}/api/repositories/:repoId`, ({ params }) => {
    db.repos = db.repos.filter((item) => item.id !== params.repoId);
    return new HttpResponse(null, { status: 204, headers: { 'X-Request-Id': 'req-delete' } });
  }),
  http.post(`${API}/api/repositories/:repoId/sync`, () => json({ data: db.sync }, 200, 'req-sync')),
  http.get(`${API}/api/repositories/:repoId/pull-requests`, ({ request }) => {
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    const page = Number(url.searchParams.get('page') ?? '1');
    const filtered = db.pulls.filter((item) => (state ? item.state === state : true));
    const start = (page - 1) * 20;
    return json({
      data: filtered.slice(start, start + 20),
      pagination: { page, limit: 20, total: filtered.length },
    });
  }),
  http.get(`${API}/api/pull-requests/:id`, ({ params }) => {
    const found = db.pulls.find((item) => item.id === params.id);
    if (!found) {
      return json({ error: { code: 'RESOURCE_NOT_FOUND', message: 'Resource not found.' } }, 404);
    }
    return json({ data: found });
  }),
  http.get(`${API}/api/pull-requests/:prId/audits`, ({ request }) => {
    const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
    return json({ data: db.list, pagination: { page, limit: 20, total: db.list.length } });
  }),
  http.post(`${API}/api/pull-requests/:prId/audits`, () => {
    if (db.startStatus === 409) {
      return json(
        { error: { code: 'AUDIT_ALREADY_ACTIVE', message: 'Already running.', details: { audit_id: AUDIT_FROM_DB, status: 'running' } } },
        409,
        'req-active',
      );
    }
    if (db.startStatus === 429) {
      return json({ error: { code: 'TOO_MANY_ACTIVE_AUDITS', message: 'Too many.' } }, 429, 'req-cap');
    }
    return json({ data: db.startBody }, 202, 'req-start');
  }),
  http.get(`${API}/api/audits/:id`, () => json({ data: db.audit }, 200, 'req-audit')),
];

const AUDIT_FROM_DB = '44444444-4444-4444-8444-444444444444';
