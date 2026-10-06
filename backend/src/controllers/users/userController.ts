import type { Request, Response } from 'express';

import type { UserService } from '../../services/users/userService.js';
import { patchMeSchema } from '../../schemas/user.js';
import { resourceNotFound, unauthenticated } from '../../utils/errors.js';
import { presentUser } from '../../utils/present.js';
import { parseBody } from '../../middleware/validate.js';

export function createUserController(users: UserService) {
  return {
    async getMe(req: Request, res: Response): Promise<void> {
      const authUser = requireUser(req);
      const user = await users.getMe(authUser.id);
      if (!user) {
        throw resourceNotFound();
      }
      res.status(200).json({ data: presentUser(user) });
    },

    async patchMe(req: Request, res: Response): Promise<void> {
      const authUser = requireUser(req);
      const body = parseBody(patchMeSchema, req.body);
      const user = await users.updateDisplayName(authUser.id, body.display_name);
      res.status(200).json({ data: presentUser(user) });
    },
  };
}

function requireUser(req: Request) {
  if (!req.user) {
    throw unauthenticated();
  }
  return req.user;
}
