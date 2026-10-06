import type { Request, Response } from 'express';

import { parseQuery, parseUuid } from '../../middleware/validate.js';
import { pullRequestListQuerySchema } from '../../schemas/pullRequest.js';
import type { PullRequestService } from '../../services/pullRequests/pullRequestService.js';
import { unauthenticated } from '../../utils/errors.js';
import { presentPullRequest } from '../../utils/present.js';

export function createPullRequestController(pullRequests: PullRequestService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const repoId = parseUuid(req.params['repoId'], 'repoId');
      const query = parseQuery(pullRequestListQuerySchema, req.query);
      const result = await pullRequests.list(user.id, repoId, query.page, query.limit, query.state);
      res.status(200).json({
        data: result.items.map((item) => presentPullRequest(item)),
        pagination: { page: query.page, limit: query.limit, total: result.total },
      });
    },

    async get(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const prId = parseUuid(req.params['id'], 'id');
      const owned = await pullRequests.get(user.id, prId);
      res.status(200).json({ data: presentPullRequest(owned.pullRequest) });
    },
  };
}

function requireUser(req: Request) {
  if (!req.user) {
    throw unauthenticated();
  }
  return req.user;
}
