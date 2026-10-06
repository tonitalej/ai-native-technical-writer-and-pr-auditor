import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/env.js';

function baseEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'development',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_PUBLISHABLE_KEY: 'pub',
    SUPABASE_SECRET_KEY: 'sec',
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    OPENAI_API_KEY: 'sk-test',
    OPENAI_MODEL: 'gpt-test',
    AUDIT_WORKER_ENABLED: 'false',
    TRUST_PROXY: 'false',
    CORS_ORIGIN: '',
    ...overrides,
  };
}

describe('environment', () => {
  it('defaults development CORS and rejects an invalid encryption key without echoing it', () => {
    const config = loadConfig(baseEnv());
    expect(config.corsOrigins).toEqual(['http://localhost:5173']);
    const bad = 'not-a-valid-key';
    expect(() => loadConfig(baseEnv({ CREDENTIAL_ENCRYPTION_KEY: bad }))).toThrow(/32 bytes/);
    try {
      loadConfig(baseEnv({ CREDENTIAL_ENCRYPTION_KEY: bad }));
    } catch (error) {
      expect((error as Error).message).not.toContain(bad);
    }
  });

  it('refuses to start when production CORS is empty or stale recovery is too aggressive', () => {
    expect(() => loadConfig(baseEnv({ NODE_ENV: 'production', CORS_ORIGIN: '' }))).toThrow(/CORS_ORIGIN/);
    expect(() =>
      loadConfig(baseEnv({ AUDIT_HEARTBEAT_INTERVAL_MS: '15000', AUDIT_STALE_AFTER_SECONDS: '10' })),
    ).toThrow(/AUDIT_STALE_AFTER_SECONDS/);
  });

  it('accepts the legacy Supabase key pair when the new keys are blank', () => {
    const config = loadConfig(
      baseEnv({
        SUPABASE_PUBLISHABLE_KEY: '',
        SUPABASE_SECRET_KEY: '',
        SUPABASE_ANON_KEY: 'anon',
        SUPABASE_SERVICE_ROLE_KEY: 'service',
      }),
    );
    expect(config.supabaseKeyMode).toBe('legacy');
    expect(config.supabasePublishableKey).toBe('anon');
  });
});
