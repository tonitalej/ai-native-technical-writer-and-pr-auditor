import { Router, type RequestHandler } from 'express';

import type { AuditService } from '../services/audits/auditService.js';
import type { PullRequestService } from '../services/pullRequests/pullRequestService.js';
import type { RepositoryService } from '../services/repositories/repositoryService.js';
import type { SyncService } from '../services/repositories/syncService.js';
import type { UserService } from '../services/users/userService.js';
import { createAuditRoutes } from './audits.js';
import { createPullRequestRoutes } from './pullRequests.js';
import { createRepositoryRoutes } from './repositories.js';
import { createUserRoutes } from './users.js';

export function createApiRouter(deps: {
  users: UserService;
  repositories: RepositoryService;
  sync: SyncService;
  pullRequests: PullRequestService;
  audits: AuditService;
  connectLimiter: RequestHandler;
  auditCreateLimiter: RequestHandler;
}): Router {
  const router = Router();
  router.use(createUserRoutes(deps.users));
  router.use(createRepositoryRoutes(deps.repositories, deps.sync, deps.connectLimiter));
  router.use(createPullRequestRoutes(deps.pullRequests));
  router.use(createAuditRoutes(deps.audits, deps.auditCreateLimiter));
  return router;
}
