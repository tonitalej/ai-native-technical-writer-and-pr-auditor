import type { Request, Response } from 'express';

import { parseBody, parseQuery, parseUuid } from '../../middleware/validate.js';
import { paginationQuerySchema } from '../../schemas/common.js';
import { connectRepositorySchema } from '../../schemas/repository.js';
import type { RepositoryService } from '../../services/repositories/repositoryService.js';
import type { SyncService } from '../../services/repositories/syncService.js';
import { unauthenticated } from '../../utils/errors.js';
import { presentRepository } from '../../utils/present.js';

export function createRepositoryController(repositories: RepositoryService, sync: SyncService) {
  return {
    async list(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const query = parseQuery(paginationQuerySchema, req.query);
      const result = await repositories.list(user.id, query.page, query.limit);
      res.status(200).json({
        data: result.items.map((item) => presentRepository(item)),
        pagination: { page: query.page, limit: query.limit, total: result.total },
      });
    },

    async connect(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const body = parseBody(connectRepositorySchema, req.body);
      const result = await repositories.connect(user.id, body);
      res.status(result.created ? 201 : 200).json({ data: presentRepository(result.repository) });
    },

    async get(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const repoId = parseUuid(req.params['repoId'], 'repoId');
      const repository = await repositories.get(user.id, repoId);
      res.status(200).json({ data: presentRepository(repository) });
    },

    async remove(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const repoId = parseUuid(req.params['repoId'], 'repoId');
      await repositories.delete(user.id, repoId);
      res.status(204).send();
    },

    async syncRepo(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const repoId = parseUuid(req.params['repoId'], 'repoId');
      const result = await sync.syncRepositoryPullRequests(user.id, repoId);
      res.status(200).json({ data: result });
    },
  };
}

function requireUser(req: Request) {
  if (!req.user) {
    throw unauthenticated();
  }
  return req.user;
}
