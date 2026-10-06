import { z } from 'zod';

import { auditListItemSchema, auditSchema, createdAuditSchema, type Audit, type AuditListItem, type CreatedAudit, type Page } from '../types/api';
import { apiFetch } from './client';

const PAGE_LIMIT = 20;

export async function listAudits(prId: string, page: number): Promise<Page<AuditListItem>> {
  const result = await apiFetch(
    `/api/pull-requests/${prId}/audits?page=${page}&limit=${PAGE_LIMIT}`,
    z.array(auditListItemSchema),
  );
  return {
    items: result.data,
    pagination: result.pagination ?? { page, limit: PAGE_LIMIT, total: result.data.length },
    requestId: result.requestId,
  };
}

export async function getAudit(auditId: string): Promise<{ audit: Audit; requestId: string | null }> {
  const result = await apiFetch(`/api/audits/${auditId}`, auditSchema);
  return { audit: result.data, requestId: result.requestId };
}

export async function startAudit(prId: string): Promise<{ audit: CreatedAudit; requestId: string | null }> {
  const result = await apiFetch(`/api/pull-requests/${prId}/audits`, createdAuditSchema, { method: 'POST' });
  return { audit: result.data, requestId: result.requestId };
}
