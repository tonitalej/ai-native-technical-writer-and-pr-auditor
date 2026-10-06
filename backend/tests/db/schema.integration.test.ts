import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const databaseUrl = process.env['TEST_DATABASE_URL'];

interface QueryClient {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

describe('migration file', () => {
  it('keeps the claim, recovery, and in-flight definitions', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(path.resolve(here, '../../../database/migrations/001_initial_schema.sql'), 'utf8');
    expect(sql).toContain('claim_next_audit');
    expect(sql).toContain('audit_runs_one_inflight_per_commit');
    expect(sql).toContain('recover_stale_audits');
    expect(sql).toContain('create_pending_audit');
    expect(sql).toContain('insert_audit_diff_if_owner');
    expect(sql).toContain('TOO_MANY_ACTIVE_AUDITS');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.create_pending_audit');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.insert_audit_diff_if_owner');
  });
});

describe.skipIf(!databaseUrl)('optional database integration', () => {
  it('claim and recovery RPCs answer on an empty queue', async () => {
    const moduleName = 'pg';
    const loaded = (await import(moduleName)) as {
      Client: new (config: { connectionString: string }) => QueryClient;
    };
    const client = new loaded.Client({ connectionString: databaseUrl ?? '' });
    await client.connect();
    try {
      const claim = await client.query("select * from public.claim_next_audit('integration-test')");
      expect(claim.rows).toEqual([]);
      const recovered = await client.query('select * from public.recover_stale_audits(120)');
      expect(recovered.rows[0]).toMatchObject({ requeued: expect.any(Number), exhausted: expect.any(Number) });
    } finally {
      await client.end();
    }
  });

});
