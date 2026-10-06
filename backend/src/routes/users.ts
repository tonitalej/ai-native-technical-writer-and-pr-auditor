import { Router } from 'express';

import type { UserService } from '../services/users/userService.js';
import { createUserController } from '../controllers/users/userController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export function createUserRoutes(users: UserService): Router {
  const router = Router();
  const controller = createUserController(users);
  router.get('/me', asyncHandler(controller.getMe));
  router.patch('/me', asyncHandler(controller.patchMe));
  return router;
}
