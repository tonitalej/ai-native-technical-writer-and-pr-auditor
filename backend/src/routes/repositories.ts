import { Router, type RequestHandler } from 'express';

import { createRepositoryController } from '../controllers/repositories/repositoryController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import type { RepositoryService } from '../services/repositories/repositoryService.js';
import type { SyncService } from '../services/repositories/syncService.js';

export function createRepositoryRoutes(
  repositories: RepositoryService,
  sync: SyncService,
  connectLimiter: RequestHandler,
): Router {
  const router = Router();
  const controller = createRepositoryController(repositories, sync);
  router.get('/repositories', asyncHandler(controller.list));
  router.post('/repositories', connectLimiter, asyncHandler(controller.connect));
  router.get('/repositories/:repoId', asyncHandler(controller.get));
  router.delete('/repositories/:repoId', asyncHandler(controller.remove));
  router.post('/repositories/:repoId/sync', connectLimiter, asyncHandler(controller.syncRepo));
  return router;
}
