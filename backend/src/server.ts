import dotenv from 'dotenv';

import { createApp } from './app.js';
import { configLogSummary, loadConfig } from './config/env.js';
import { createAuditData } from './data/auditData.js';
import { createCredentialData } from './data/credentialData.js';
import { createPullRequestData } from './data/pullRequestData.js';
import { createRepositoryData } from './data/repositoryData.js';
import { createUserData } from './data/userData.js';
import { assertSupabaseReachable, createSupabaseClients } from './lib/supabase.js';
import { createSupabaseAuthVerifier } from './middleware/auth.js';
import { createOpenAiClient } from './services/ai/openaiClient.js';
import { EncryptionService } from './services/encryption/encryptionService.js';
import { GitHubProvider, githubSettingsFromConfig } from './services/github/githubProvider.js';
import { createProviderFactory } from './services/providers/providerFactory.js';
import { createLogger } from './utils/logger.js';
import { AuditWorker } from './workers/auditWorker.js';

dotenv.config();

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  logger.info(configLogSummary(config), 'configuration loaded');

  const clients = createSupabaseClients(config);
  await assertSupabaseReachable(clients.service);

  const encryption = new EncryptionService(config.credentialEncryptionKey);
  const providers = createProviderFactory(new GitHubProvider(githubSettingsFromConfig(config)));
  const ai = createOpenAiClient(config);
  const users = createUserData(clients.service);
  const repositories = createRepositoryData(clients.service);
  const credentials = createCredentialData(clients.service);
  const pullRequests = createPullRequestData(clients.service);
  const audits = createAuditData(clients.service);

  const worker = new AuditWorker({
    config,
    logger,
    audits,
    credentials,
    providers,
    ai,
    encryption,
  });

  const app = createApp({
    config,
    logger,
    auth: createSupabaseAuthVerifier(clients.auth),
    users,
    repositories,
    credentials,
    pullRequests,
    audits,
    encryption,
    providers,
    ai,
    onAuditQueued: () => {
      worker.wake();
    },
  });

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'server listening');
  });

  if (config.auditWorkerEnabled) {
    worker.start();
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const closed = new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('http server closed');
        resolve();
      });
    });
    void Promise.race([
      Promise.all([closed, worker.stop(config.shutdownTimeoutMs)]),
      new Promise((resolve) => {
        setTimeout(resolve, config.shutdownTimeoutMs);
      }),
    ]).finally(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'startup failed';
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
