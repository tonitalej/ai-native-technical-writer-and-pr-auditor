import { Router, type RequestHandler } from 'express';

import { createAuditController } from '../controllers/audits/auditController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import type { AuditService } from '../services/audits/auditService.js';

export function createAuditRoutes(audits: AuditService, auditCreateLimiter: RequestHandler): Router {
  const router = Router();
  const controller = createAuditController(audits);
  router.post('/pull-requests/:prId/audits', auditCreateLimiter, asyncHandler(controller.create));
  router.get('/pull-requests/:prId/audits', asyncHandler(controller.list));
  router.get('/audits/:id', asyncHandler(controller.get));
  return router;
}
