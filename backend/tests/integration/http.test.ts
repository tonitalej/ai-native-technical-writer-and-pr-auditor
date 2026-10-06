import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildTestApp } from '../helpers/testApp.js';
import { SHA_B, samplePull } from '../fakes/fakeProvider.js';
import { processClaimedAudit } from '../../src/services/audits/processAudit.js';
import { ActiveAuditCapError } from '../../src/utils/errors.js';
import { AuditWorker } from '../../src/workers/auditWorker.js';

const TOKEN = 'Bearer valid-token';
const OTHER = 'Bearer other-token';

describe('authentication', () => {
  it('rejects missing, malformed, invalid, and expired tokens and accepts a valid one', async () => {
    const { app } = buildTestApp();
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', 'Token abc')).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer expired-token')).status).toBe(401);
    const ok = await request(app).get('/api/me').set('Authorization', TOKEN);
    expect(ok.status).toBe(200);
    expect(ok.body.data.email).toBe('one@example.com');
    expect(ok.body.error).toBeUndefined();
  });

  it('updates only display_name', async () => {
    const { app } = buildTestApp();
    const updated = await request(app)
      .patch('/api/me')
      .set('Authorization', TOKEN)
      .send({ display_name: '  Ada  ' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.display_name).toBe('Ada');
    const rejected = await request(app)
      .patch('/api/me')
      .set('Authorization', TOKEN)
      .send({ display_name: 'Ada', email: 'other@example.com' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(rejected.body)).not.toContain('other@example.com');
  });
});

describe('repositories, sync, and authorization', () => {
  it('connects, rotates, hides secrets, and returns 404 for someone else', async () => {
    const { app, db, provider } = buildTestApp();
    const created = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'https://github.com/octocat/hello.git', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('ghp_');
    expect(JSON.stringify(created.body)).not.toContain('ciphertext');
    expect(created.body.data.owner).toBe('octocat');
    expect(created.body.data.is_private).toBe(true);
    const repoId = created.body.data.id as string;

    const rotated = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'gho_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.id).toBe(repoId);
    const credential = [...db.credentials.values()][0];
    expect(credential?.ciphertext).not.toContain('gho_');

    provider.repository = { ...provider.repository, providerRepositoryId: '999', owner: 'Octocat', name: 'Hello' };
    const variant = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'Octocat/Hello', token: 'ghu_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(variant.status).toBe(200);
    expect(variant.body.data.id).toBe(repoId);

    db.failNextCreate = true;
    provider.repository = {
      ...provider.repository,
      providerRepositoryId: 'race-id',
      owner: 'other',
      name: 'repo',
      htmlUrl: 'https://github.com/other/repo',
    };
    const raced = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'other/repo', token: 'ghs_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(raced.status).toBe(200);
    expect(raced.status).not.toBe(500);

    const invalid = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/missing', token: 'bad-token' });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('GITHUB_TOKEN_INVALID');

    provider.missingRepository = true;
    const missing = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/missing', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PROVIDER_RESOURCE_NOT_FOUND');
    provider.missingRepository = false;

    const foreign = await request(app).get(`/api/repositories/${repoId}`).set('Authorization', OTHER);
    const absent = await request(app).get(`/api/repositories/${randomUUID()}`).set('Authorization', OTHER);
    expect(foreign.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(foreign.body).toEqual(absent.body);

    const malformed = await request(app).get('/api/repositories/not-a-uuid').set('Authorization', TOKEN);
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('syncs pull requests idempotently and preserves additions', async () => {
    const { app, db, provider } = buildTestApp();
    provider.pulls = [
      samplePull({ number: 2, providerPrId: '2', state: 'open', headSha: 'a'.repeat(40) }),
      samplePull({
        number: 9,
        providerPrId: '9',
        state: 'merged',
        headSha: 'b'.repeat(40),
        closedAt: '2026-03-01T00:00:00.000Z',
        mergedAt: '2026-03-01T00:00:00.000Z',
      }),
    ];
    const created = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    const repoId = created.body.data.id as string;
    const synced = await request(app).post(`/api/repositories/${repoId}/sync`).set('Authorization', TOKEN);
    expect(synced.status).toBe(200);
    expect(synced.body.data.synced).toBe(2);
    expect(synced.body.data.truncated).toBe(false);
    const listed = await request(app).get(`/api/repositories/${repoId}/pull-requests`).set('Authorization', TOKEN);
    expect(listed.body.data.map((item: { pr_number: number }) => item.pr_number)).toEqual([9, 2]);
    expect(listed.body.data[0].state).toBe('merged');
    const prId = listed.body.data[1].id as string;
    const stored = db.pullRequests.get(prId);
    if (!stored) {
      throw new Error('missing pr');
    }
    stored.additions = 12;
    stored.deletions = 4;
    await request(app).post(`/api/repositories/${repoId}/sync`).set('Authorization', TOKEN);
    const again = await request(app).get(`/api/pull-requests/${prId}`).set('Authorization', TOKEN);
    expect(again.body.data.additions).toBe(12);
    expect(again.body.data.deletions).toBe(4);

    const hidden = await request(app).get(`/api/pull-requests/${prId}`).set('Authorization', OTHER);
    const missingPr = await request(app).get(`/api/pull-requests/${randomUUID()}`).set('Authorization', OTHER);
    expect(hidden.status).toBe(404);
    expect(hidden.body).toEqual(missingPr.body);

    const removed = await request(app).delete(`/api/repositories/${repoId}`).set('Authorization', TOKEN);
    expect(removed.status).toBe(204);
    expect(db.repositories.size).toBe(0);
    expect(db.credentials.size).toBe(0);
    expect(db.pullRequests.size).toBe(0);
  });
});

describe('audits', () => {
  it('queues an audit against the fresh head sha and rejects a duplicate in-flight audit', async () => {
    const { app, provider } = buildTestApp();
    provider.pulls = [samplePull({ headSha: 'c'.repeat(40) })];
    const repo = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const prId = prs.body.data[0].id as string;
    provider.pulls = [samplePull({ headSha: SHA_B })];
    const queued = await request(app).post(`/api/pull-requests/${prId}/audits`).set('Authorization', TOKEN);
    expect(queued.status).toBe(202);
    expect(queued.headers.location).toBe(`/api/audits/${queued.body.data.id}`);
    expect(queued.body.data.commit_sha).toBe(SHA_B);
    expect(queued.body.data.status).toBe('pending');
    const duplicate = await request(app).post(`/api/pull-requests/${prId}/audits`).set('Authorization', TOKEN);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('AUDIT_ALREADY_ACTIVE');
    expect(duplicate.body.error.details.audit_id).toBe(queued.body.data.id);

    const foreign = await request(app).get(`/api/audits/${queued.body.data.id}`).set('Authorization', OTHER);
    const missing = await request(app).get(`/api/audits/${randomUUID()}`).set('Authorization', OTHER);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('enforces the active audit cap for a single request', async () => {
    const { app, provider } = buildTestApp({ config: { maxActiveAuditsPerUser: 1 } });
    provider.pulls = [samplePull(), samplePull({ number: 8, providerPrId: '800', headSha: 'd'.repeat(40) })];
    const repo = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const first = await request(app)
      .post(`/api/pull-requests/${prs.body.data[0].id}/audits`)
      .set('Authorization', TOKEN);
    expect(first.status).toBe(202);
    provider.headShas = ['e'.repeat(40)];
    const second = await request(app)
      .post(`/api/pull-requests/${prs.body.data[1].id}/audits`)
      .set('Authorization', TOKEN);
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('TOO_MANY_ACTIVE_AUDITS');
  });

  it('enforces the active audit cap inside the insert itself', async () => {
    const { app, db } = buildTestApp();
    const repo = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const prId = prs.body.data[0].id as string;
    const userId = '11111111-1111-4111-8111-111111111111';
    await db.insertPending({
      userId,
      prId,
      commitSha: 'a'.repeat(40),
      maxAttempts: 3,
      maxActive: 1,
    });
    await expect(
      db.insertPending({
        userId,
        prId,
        commitSha: 'b'.repeat(40),
        maxAttempts: 3,
        maxActive: 1,
      }),
    ).rejects.toBeInstanceOf(ActiveAuditCapError);
    expect(db.audits.size).toBe(1);
  });
});

describe('worker lifecycle', () => {
  it('claims, completes, fences, and records failure codes', async () => {
    const ctx = buildTestApp();
    const repo = await request(ctx.app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(ctx.app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(ctx.app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const queued = await request(ctx.app)
      .post(`/api/pull-requests/${prs.body.data[0].id}/audits`)
      .set('Authorization', TOKEN);
    const worker = new AuditWorker({
      config: ctx.config,
      logger: ctx.logs.logger,
      audits: ctx.data.audits,
      credentials: ctx.data.credentials,
      providers: { getProvider: () => ctx.provider },
      ai: ctx.ai,
      encryption: ctx.encryption,
    });
    await worker.tick();
    const completed = ctx.db.audits.get(queued.body.data.id as string);
    expect(completed?.status).toBe('completed');
    expect(completed?.risk_level).toBe('high');
    expect(completed?.model).toBe('gpt-test-snapshot');
    expect(completed?.prompt_version).toBe('v1');
    expect(completed?.token_usage).toEqual({ prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 });
    expect(completed?.error_code).toBeNull();
    expect(completed?.generated_documentation).toContain('What changed');
    expect(ctx.db.diffs.get(completed?.id ?? '')).toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    const stored = ctx.db.diffs.get(completed?.id ?? '');
    const claimedRow = completed;
    if (!claimedRow?.worker_id) {
      throw new Error('expected a completed audit with a worker id');
    }
    claimedRow.status = 'running';
    claimedRow.completed_at = null;
    const kept = await ctx.data.audits.insertOwnedDiff(
      { id: claimedRow.id, workerId: claimedRow.worker_id, attempts: claimedRow.attempts },
      'diff --git a/other.ts b/other.ts\nreplacement',
    );
    expect(kept).toBe(true);
    expect(ctx.db.diffs.get(claimedRow.id)).toBe(stored);
    claimedRow.status = 'completed';
    claimedRow.completed_at = claimedRow.updated_at;
    const prompt = JSON.stringify(ctx.ai.messages);
    expect(prompt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(prompt).toContain('[REDACTED:github-token]');
    expect(prompt).toContain('untrusted_diff boundary=');
    const view = await request(ctx.app).get(`/api/audits/${queued.body.data.id}`).set('Authorization', TOKEN);
    expect(view.body.data.worker_id).toBeUndefined();
    expect(view.body.data.generated_documentation).toContain('What changed');
    expect(JSON.stringify(view.body)).not.toContain('ghp_');

    const stale = [...ctx.db.audits.values()][0];
    if (!stale) {
      throw new Error('missing audit');
    }
    stale.status = 'running';
    stale.worker_id = 'old-worker';
    stale.attempts = 1;
    stale.heartbeat_at = '2020-01-01T00:00:00.000Z';
    stale.completed_at = null;
    stale.max_attempts = 3;
    const recoveryWorker = new AuditWorker({
      config: { ...ctx.config, auditWorkerConcurrency: 0 },
      logger: ctx.logs.logger,
      audits: ctx.data.audits,
      credentials: ctx.data.credentials,
      providers: { getProvider: () => ctx.provider },
      ai: ctx.ai,
      encryption: ctx.encryption,
    });
    await recoveryWorker.tick();
    expect(ctx.db.audits.get(stale.id)?.status).toBe('pending');

    stale.status = 'running';
    stale.worker_id = 'old-worker';
    stale.attempts = 3;
    stale.max_attempts = 3;
    stale.heartbeat_at = '2020-01-01T00:00:00.000Z';
    stale.completed_at = null;
    const exhausted = await ctx.data.audits.recoverStale(ctx.config.auditStaleAfterSeconds);
    expect(exhausted.exhausted).toBe(1);
    expect(ctx.db.audits.get(stale.id)?.status).toBe('failed');
    expect(ctx.db.audits.get(stale.id)?.error_code).toBe('AUDIT_ATTEMPTS_EXHAUSTED');
  });

  it('does not let a superseded worker write and abandons a deleted repository', async () => {
    const ctx = buildTestApp();
    const repo = await request(ctx.app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(ctx.app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(ctx.app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const queued = await request(ctx.app)
      .post(`/api/pull-requests/${prs.body.data[0].id}/audits`)
      .set('Authorization', TOKEN);
    expect(queued.status).toBe(202);
    const claimed = await ctx.data.audits.claimNext('worker-a');
    if (!claimed) {
      throw new Error('expected a claim');
    }
    const row = ctx.db.audits.get(claimed.id);
    if (!row) {
      throw new Error('missing row');
    }
    row.worker_id = 'worker-b';
    await processClaimedAudit(
      {
        config: ctx.config,
        audits: ctx.data.audits,
        credentials: ctx.data.credentials,
        providers: { getProvider: () => ctx.provider },
        ai: ctx.ai,
        encryption: ctx.encryption,
        logger: ctx.logs.logger,
      },
      claimed,
    );
    expect(ctx.db.audits.get(claimed.id)?.status).toBe('running');
    expect(ctx.db.audits.get(claimed.id)?.worker_id).toBe('worker-b');
    expect(ctx.db.diffs.has(claimed.id)).toBe(false);

    const second = await request(ctx.app).post(`/api/pull-requests/${prs.body.data[0].id}/audits`).set('Authorization', TOKEN);
    expect(second.status).toBe(409);
    const another = [...ctx.db.audits.values()].find((audit) => audit.status === 'pending');
    expect(another).toBeUndefined();

    const fresh = await ctx.db.insertPending({
      userId: '11111111-1111-4111-8111-111111111111',
      prId: prs.body.data[0].id as string,
      commitSha: 'f'.repeat(40),
      maxAttempts: 3,
      maxActive: 10,
    });
    ctx.provider.headShas = ['f'.repeat(40), 'f'.repeat(40)];
    const claimedFresh = await ctx.data.audits.claimNext('worker-c');
    if (!claimedFresh) {
      throw new Error('expected fresh claim');
    }
    ctx.provider.onGetPullRequest = () => {
      void ctx.db.deleteOwned('11111111-1111-4111-8111-111111111111', repo.body.data.id as string);
    };
    await expect(
      processClaimedAudit(
        {
          config: ctx.config,
          audits: ctx.data.audits,
          credentials: ctx.data.credentials,
          providers: { getProvider: () => ctx.provider },
          ai: ctx.ai,
          encryption: ctx.encryption,
          logger: ctx.logs.logger,
        },
        claimedFresh,
      ),
    ).resolves.toBeUndefined();
    expect(ctx.db.audits.has(fresh.id)).toBe(false);
  });

  it('fails when the head SHA changes before or after the diff is fetched', async () => {
    const ctx = buildTestApp();
    const repo = await request(ctx.app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(ctx.app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(ctx.app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const prId = prs.body.data[0].id as string;
    const before = await ctx.db.insertPending({
      userId: '11111111-1111-4111-8111-111111111111',
      prId,
      commitSha: 'a'.repeat(40),
      maxAttempts: 3,
      maxActive: 10,
    });
    ctx.provider.headShas = ['b'.repeat(40)];
    const claimedBefore = await ctx.data.audits.claimNext('worker-before');
    if (!claimedBefore) {
      throw new Error('claim');
    }
    await processClaimedAudit(deps(ctx), claimedBefore);
    expect(ctx.db.audits.get(before.id)?.error_code).toBe('HEAD_SHA_CHANGED');
    expect(ctx.db.diffs.has(before.id)).toBe(false);

    const after = await ctx.db.insertPending({
      userId: '11111111-1111-4111-8111-111111111111',
      prId,
      commitSha: 'c'.repeat(40),
      maxAttempts: 3,
      maxActive: 10,
    });
    ctx.provider.headShas = ['c'.repeat(40), 'd'.repeat(40)];
    const claimedAfter = await ctx.data.audits.claimNext('worker-after');
    if (!claimedAfter) {
      throw new Error('claim');
    }
    await processClaimedAudit(deps(ctx), claimedAfter);
    expect(ctx.db.audits.get(after.id)?.error_code).toBe('HEAD_SHA_CHANGED');
    expect(ctx.db.diffs.has(after.id)).toBe(false);
  });
});

function deps(ctx: ReturnType<typeof buildTestApp>) {
  return {
    config: ctx.config,
    audits: ctx.data.audits,
    credentials: ctx.data.credentials,
    providers: { getProvider: () => ctx.provider },
    ai: ctx.ai,
    encryption: ctx.encryption,
    logger: ctx.logs.logger,
  };
}

describe('partial analysis', () => {
  it('marks truncated coverage and prepends a notice', async () => {
    const ctx = buildTestApp();
    const repo = await request(ctx.app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' });
    await request(ctx.app).post(`/api/repositories/${repo.body.data.id}/sync`).set('Authorization', TOKEN);
    const prs = await request(ctx.app)
      .get(`/api/repositories/${repo.body.data.id}/pull-requests`)
      .set('Authorization', TOKEN);
    const queued = await request(ctx.app)
      .post(`/api/pull-requests/${prs.body.data[0].id}/audits`)
      .set('Authorization', TOKEN);
    const first = 'diff --git a/src/a.ts b/src/a.ts\n+a\n';
    const second = `diff --git a/src/b.ts b/src/b.ts\n+${'b'.repeat(80)}\n`;
    ctx.provider.diffText = `${first}${second}`;
    const claimed = await ctx.data.audits.claimNext('worker-partial');
    if (!claimed) {
      throw new Error('expected a claim');
    }
    await processClaimedAudit(
      {
        ...deps(ctx),
        config: { ...ctx.config, auditMaxDiffAnalyzeBytes: Buffer.byteLength(first) },
      },
      claimed,
    );
    const audit = ctx.db.audits.get(queued.body.data.id as string);
    expect(audit?.status).toBe('completed');
    expect(audit?.diff_truncated).toBe(true);
    expect(audit?.diff_omitted_files.some((file) => file.path === 'src/b.ts')).toBe(true);
    expect(audit?.generated_documentation.startsWith('> **Partial analysis.**')).toBe(true);
  });
});

describe('security controls', () => {
  it('limits body size, rate limits, and CORS origins', async () => {
    const { app } = buildTestApp({
      rateLimits: {
        general: { windowMs: 60_000, limit: 2 },
        connect: { windowMs: 60_000, limit: 10 },
        auditCreate: { windowMs: 60_000, limit: 10 },
        authFailure: { windowMs: 60_000, limit: 2 },
      },
    });
    const huge = await request(app)
      .post('/api/repositories')
      .set('Authorization', TOKEN)
      .send({ repository: 'octocat/hello', token: 'x'.repeat(200_000) });
    expect(huge.status).toBe(413);

    const health = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
    expect(health.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const first = await request(app).get('/api/me').set('Authorization', 'Bearer nope');
    const second = await request(app).get('/api/me').set('Authorization', 'Bearer nope');
    const third = await request(app).get('/api/me').set('Authorization', 'Bearer nope');
    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not log the GitHub token', async () => {
    const ctx = buildTestApp();
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    await request(ctx.app).post('/api/repositories').set('Authorization', TOKEN).send({
      repository: 'octocat/hello',
      token,
    });
    expect(ctx.logs.text()).not.toContain(token);
    expect(ctx.logs.text()).not.toContain('test-secret');
    expect(ctx.logs.text()).not.toContain('test-openai-key');
  });
});
