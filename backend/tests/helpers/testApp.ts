import { Writable } from 'node:stream';
import { randomBytes } from 'node:crypto';

import { createApp, type AppDependencies } from '../../src/app.js';
import type { AppConfig } from '../../src/config/env.js';
import { EncryptionService } from '../../src/services/encryption/encryptionService.js';
import type { AuthVerifier } from '../../src/middleware/auth.js';
import type { AuthUser } from '../../src/types/domain.js';
import { createLogger, type AppLogger } from '../../src/utils/logger.js';
import { FakeAi } from '../fakes/fakeAi.js';
import { FakeGitHub } from '../fakes/fakeProvider.js';
import { MemoryDatabase, createMemoryAdapters } from '../fakes/memoryDatabase.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    nodeEnv: 'test',
    port: 0,
    logLevel: 'silent',
    trustProxy: false,
    corsOrigins: ['http://localhost:5173'],
    supabaseUrl: 'http://127.0.0.1:54321',
    supabasePublishableKey: 'test-publishable',
    supabaseSecretKey: 'test-secret',
    supabaseKeyMode: 'publishable',
    credentialEncryptionKey: randomBytes(32),
    openaiApiKey: 'test-openai-key',
    openaiModel: 'test-model',
    openaiTimeoutMs: 5000,
    openaiMaxOutputTokens: 8000,
    githubApiBaseUrl: 'https://api.github.com',
    githubApiVersion: '2026-03-10',
    githubTimeoutMs: 5000,
    githubSyncMaxPages: 2,
    auditWorkerEnabled: false,
    auditWorkerIntervalMs: 2000,
    auditWorkerConcurrency: 1,
    auditHeartbeatIntervalMs: 60_000,
    auditStaleAfterSeconds: 180,
    auditMaxAttempts: 3,
    auditMaxProcessingMs: 30_000,
    auditMaxDiffFetchBytes: 2_000_000,
    auditMaxDiffAnalyzeBytes: 300_000,
    maxActiveAuditsPerUser: 3,
    shutdownTimeoutMs: 1000,
    ...overrides,
  };
}

export class FakeAuth implements AuthVerifier {
  readonly users = new Map<string, AuthUser>();
  readonly expired = new Set<string>();

  async verify(token: string) {
    if (this.expired.has(token)) {
      return { ok: false as const, reason: 'expired' as const };
    }
    const user = this.users.get(token);
    if (!user) {
      return { ok: false as const, reason: 'invalid' as const };
    }
    return { ok: true as const, user };
  }
}

export function captureLogger(): { logger: AppLogger; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return {
    logger: createLogger('info', stream),
    text: () => chunks.join(''),
  };
}

export function buildTestApp(options?: {
  config?: Partial<AppConfig>;
  rateLimits?: AppDependencies['rateLimits'];
}) {
  const db = new MemoryDatabase();
  const data = createMemoryAdapters(db);
  const config = testConfig(options?.config);
  const encryption = new EncryptionService(config.credentialEncryptionKey);
  const provider = new FakeGitHub();
  const ai = new FakeAi();
  const logs = captureLogger();
  const auth = new FakeAuth();
  auth.users.set('valid-token', { id: '11111111-1111-4111-8111-111111111111', email: 'one@example.com' });
  auth.users.set('other-token', { id: '22222222-2222-4222-8222-222222222222', email: 'two@example.com' });
  auth.expired.add('expired-token');
  const app = createApp({
    config,
    logger: logs.logger,
    auth,
    ...data,
    encryption,
    providers: { getProvider: () => provider },
    ai,
    rateLimits: options?.rateLimits ?? {
      general: { windowMs: 60_000, limit: 10_000 },
      connect: { windowMs: 60_000, limit: 10_000 },
      auditCreate: { windowMs: 60_000, limit: 10_000 },
      authFailure: { windowMs: 60_000, limit: 10_000 },
    },
  });
  return { app, db, data, provider, ai, logs, auth, encryption, config };
}
