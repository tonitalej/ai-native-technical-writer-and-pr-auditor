import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { RATE_LIMITS, REQUEST_ID_PATTERN } from './config/constants.js';
import type { AppConfig } from './config/env.js';
import type { AuditData, CredentialData, PullRequestData, RepositoryData, UserData } from './data/contracts.js';
import { createRequireAuth, type AuthVerifier } from './middleware/auth.js';
import { createErrorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import {
  createAuthFailureLimiter,
  createGeneralLimiter,
  createUserLimiter,
  type RateLimitSettings,
} from './middleware/rateLimit.js';
import { createApiRouter } from './routes/index.js';
import type { AiClient } from './services/ai/aiService.js';
import { AuditService } from './services/audits/auditService.js';
import type { EncryptionService } from './services/encryption/encryptionService.js';
import type { ProviderFactory } from './services/providers/providerFactory.js';
import { PullRequestService } from './services/pullRequests/pullRequestService.js';
import { RepositoryService } from './services/repositories/repositoryService.js';
import { SyncService } from './services/repositories/syncService.js';
import { UserService } from './services/users/userService.js';
import type { AppLogger } from './utils/logger.js';

export interface AppDependencies {
  config: AppConfig;
  logger: AppLogger;
  auth: AuthVerifier;
  users: UserData;
  repositories: RepositoryData;
  credentials: CredentialData;
  pullRequests: PullRequestData;
  audits: AuditData;
  encryption: EncryptionService;
  providers: ProviderFactory;
  ai: AiClient;
  rateLimits?: {
    general: RateLimitSettings;
    connect: RateLimitSettings;
    auditCreate: RateLimitSettings;
    authFailure: RateLimitSettings;
  };
  onAuditQueued?: () => void;
}

export function createApp(deps: AppDependencies): express.Express {
  const limits = deps.rateLimits ?? {
    general: RATE_LIMITS.general,
    connect: RATE_LIMITS.connect,
    auditCreate: RATE_LIMITS.auditCreate,
    authFailure: RATE_LIMITS.authFailure,
  };
  const users = new UserService(deps.users);
  const repositories = new RepositoryService(
    deps.repositories,
    deps.credentials,
    deps.encryption,
    deps.providers,
    deps.logger,
  );
  const sync = new SyncService(
    deps.repositories,
    deps.credentials,
    deps.pullRequests,
    deps.encryption,
    deps.providers,
    deps.config,
    deps.logger,
  );
  const pullRequests = new PullRequestService(deps.repositories, deps.pullRequests);
  const audits = new AuditService(
    deps.audits,
    deps.pullRequests,
    sync,
    deps.providers,
    deps.config,
    deps.logger,
    deps.onAuditQueued,
  );

  const app = express();
  if (deps.config.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const requestId = incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  });
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req) => {
        const request = req as express.Request;
        return request.requestId ?? randomUUID();
      },
      customProps: (req) => ({ request_id: (req as express.Request).requestId }),
      serializers: {
        req(req) {
          return { id: req.id, method: req.method, url: req.url };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || deps.config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Location', 'Retry-After'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use(createGeneralLimiter(limits.general));
  app.use('/api', createAuthFailureLimiter(limits.authFailure));
  app.use('/api', createRequireAuth(deps.auth, deps.users, deps.logger));
  app.use(
    '/api',
    createApiRouter({
      users,
      repositories,
      sync,
      pullRequests,
      audits,
      connectLimiter: createUserLimiter(limits.connect),
      auditCreateLimiter: createUserLimiter(limits.auditCreate),
    }),
  );
  app.use(notFound);
  app.use(createErrorHandler(deps.logger));
  return app;
}
