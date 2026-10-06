import type { Request, Response } from 'express';

import { parseQuery, parseUuid } from '../../middleware/validate.js';
import { auditListQuerySchema } from '../../schemas/audit.js';
import type { AuditService } from '../../services/audits/auditService.js';
import { unauthenticated } from '../../utils/errors.js';
import { presentAudit, presentAuditListItem } from '../../utils/present.js';

export function createAuditController(audits: AuditService) {
  return {
    async create(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const prId = parseUuid(req.params['prId'], 'prId');
      const audit = await audits.create(user.id, prId);
      res.setHeader('Location', `/api/audits/${audit.id}`);
      res.status(202).json({
        data: {
          id: audit.id,
          pr_id: audit.pr_id,
          commit_sha: audit.commit_sha,
          status: audit.status,
        },
      });
    },

    async list(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const prId = parseUuid(req.params['prId'], 'prId');
      const query = parseQuery(auditListQuerySchema, req.query);
      const result = await audits.list(user.id, prId, query.page, query.limit);
      res.status(200).json({
        data: result.items.map((item) => presentAuditListItem(item)),
        pagination: { page: query.page, limit: query.limit, total: result.total },
      });
    },

    async get(req: Request, res: Response): Promise<void> {
      const user = requireUser(req);
      const auditId = parseUuid(req.params['id'], 'id');
      const audit = await audits.get(user.id, auditId);
      res.status(200).json({ data: presentAudit(audit) });
    },
  };
}

function requireUser(req: Request) {
  if (!req.user) {
    throw unauthenticated();
  }
  return req.user;
}
