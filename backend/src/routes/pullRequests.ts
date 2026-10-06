import { Router } from 'express';

import { createPullRequestController } from '../controllers/pullRequests/pullRequestController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import type { PullRequestService } from '../services/pullRequests/pullRequestService.js';

export function createPullRequestRoutes(pullRequests: PullRequestService): Router {
  const router = Router();
  const controller = createPullRequestController(pullRequests);
  router.get('/repositories/:repoId/pull-requests', asyncHandler(controller.list));
  router.get('/pull-requests/:id', asyncHandler(controller.get));
  return router;
}
