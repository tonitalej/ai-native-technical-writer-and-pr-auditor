import type { SupabaseClient } from '@supabase/supabase-js';

import type { AuditFencedWrite, ClaimedAudit, ProcessingContext } from '../types/audit.js';
import { pageRange } from '../utils/pagination.js';
import type { AuditData, AuditListRecord } from './contracts.js';
import { AUDIT_COLUMNS, AUDIT_LIST_COLUMNS, parseAudit } from './rows.js';
import { raiseDatabaseError, unwrapRow } from './supabaseErrors.js';
import { z } from 'zod';

const RECOVERY_MESSAGE =
  'The audit was interrupted repeatedly and was stopped. Please start a new audit.';

export function createAuditData(supabase: SupabaseClient): AuditData {
  return {
    async countActiveForUser(userId) {
      const { count, error } = await supabase
        .from('audit_runs')
        .select('id, pull_requests!inner(id, repositories!inner(user_id))', { count: 'exact', head: true })
        .eq('pull_requests.repositories.user_id', userId)
        .in('status', ['pending', 'running']);
      raiseDatabaseError(error);
      return count ?? 0;
    },

    async insertPending(input) {
      const { data, error } = await supabase.rpc('create_pending_audit', {
        p_user_id: input.userId,
        p_pr_id: input.prId,
        p_commit_sha: input.commitSha,
        p_max_attempts: input.maxAttempts,
        p_max_active: input.maxActive,
      });
      raiseDatabaseError(error);
      return z
        .object({
          id: z.string(),
          pr_id: z.string(),
          commit_sha: z.string(),
          status: z.literal('pending'),
        })
        .parse(unwrapRow(data));
    },

    async findInflightForOwnedPullRequest(userId, prId, commitSha) {
      const { data, error } = await supabase
        .from('audit_runs')
        .select('id, status, pull_requests!inner(id, repositories!inner(user_id))')
        .eq('pr_id', prId)
        .eq('commit_sha', commitSha)
        .in('status', ['pending', 'running'])
        .eq('pull_requests.repositories.user_id', userId)
        .maybeSingle();
      raiseDatabaseError(error);
      if (!data) {
        return null;
      }
      const row = z.object({ id: z.string(), status: z.enum(['pending', 'running', 'completed', 'failed']) }).parse(data);
      return { id: row.id, status: row.status };
    },

    async listForOwnedPullRequest(userId, prId, page, limit) {
      const { from, to } = pageRange(page, limit);
      const { data, error, count } = await supabase
        .from('audit_runs')
        .select(`${AUDIT_LIST_COLUMNS}, pull_requests!inner(id, repositories!inner(user_id))`, { count: 'exact' })
        .eq('pr_id', prId)
        .eq('pull_requests.repositories.user_id', userId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, to);
      raiseDatabaseError(error);
      const items: AuditListRecord[] = (data ?? []).map((row) => {
        const audit = parseAudit(listRowToAudit(row));
        return {
          id: audit.id,
          pr_id: audit.pr_id,
          commit_sha: audit.commit_sha,
          status: audit.status,
          risk_level: audit.risk_level,
          summary: audit.summary,
          ai_security_flags: audit.ai_security_flags,
          model: audit.model,
          prompt_version: audit.prompt_version,
          diff_truncated: audit.diff_truncated,
          duration_ms: audit.duration_ms,
          created_at: audit.created_at,
          completed_at: audit.completed_at,
          error_code: audit.error_code,
          error_message: audit.error_message,
        };
      });
      return { items, total: count ?? 0 };
    },

    async getOwned(userId, auditId) {
      const { data, error } = await supabase
        .from('audit_runs')
        .select(`${AUDIT_COLUMNS}, pull_requests!inner(id, repositories!inner(user_id))`)
        .eq('id', auditId)
        .eq('pull_requests.repositories.user_id', userId)
        .maybeSingle();
      raiseDatabaseError(error);
      return data ? parseAudit(data) : null;
    },

    async claimNext(workerId): Promise<ClaimedAudit | null> {
      const { data, error } = await supabase.rpc('claim_next_audit', { p_worker_id: workerId });
      raiseDatabaseError(error);
      const row = unwrapRow(data);
      if (!row) {
        return null;
      }
      const audit = parseAudit(row);
      if (audit.status !== 'running' || !audit.worker_id) {
        return null;
      }
      return {
        id: audit.id,
        pr_id: audit.pr_id,
        commit_sha: audit.commit_sha,
        status: 'running',
        attempts: audit.attempts,
        max_attempts: audit.max_attempts,
        worker_id: audit.worker_id,
      };
    },

    async recoverStale(staleAfterSeconds) {
      const { data, error } = await supabase.rpc('recover_stale_audits', {
        p_stale_after_seconds: staleAfterSeconds,
      });
      raiseDatabaseError(error);
      const row = unwrapRow(data);
      const parsed = z
        .object({ requeued: z.number().int(), exhausted: z.number().int() })
        .safeParse(row);
      if (!parsed.success) {
        return { requeued: 0, exhausted: 0 };
      }
      return parsed.data;
    },

    async fencedUpdate(fence, patch: AuditFencedWrite) {
      const { data, error } = await supabase
        .from('audit_runs')
        .update(patch)
        .eq('id', fence.id)
        .eq('status', 'running')
        .eq('worker_id', fence.workerId)
        .eq('attempts', fence.attempts)
        .select('id');
      if (error?.code === '23503') {
        return false;
      }
      raiseDatabaseError(error);
      return (data ?? []).length === 1;
    },

    async insertOwnedDiff(fence, rawDiff) {
      const { data, error } = await supabase.rpc('insert_audit_diff_if_owner', {
        p_audit_id: fence.id,
        p_worker_id: fence.workerId,
        p_attempts: fence.attempts,
        p_raw_diff: rawDiff,
      });
      raiseDatabaseError(error);
      return unwrapBoolean(data);
    },

    async getProcessingContext(auditId): Promise<ProcessingContext | null> {
      const { data, error } = await supabase
        .from('audit_runs')
        .select(
          `id, pr_id, commit_sha, status, attempts, max_attempts, worker_id,
           pull_requests!inner (
             id, pr_number, head_sha, title,
             repositories!inner (
               id, user_id, provider, owner, repo_name, provider_repository_id
             )
           )`,
        )
        .eq('id', auditId)
        .maybeSingle();
      raiseDatabaseError(error);
      if (!data) {
        return null;
      }
      const normalized = {
        ...(data as Record<string, unknown>),
        pull_requests: nest(one((data as Record<string, unknown>)['pull_requests']), 'repositories'),
      };
      const parsed = processingContextSchema.safeParse(normalized);
      if (!parsed.success || !parsed.data.pull_requests) {
        return null;
      }
      const pull = parsed.data.pull_requests;
      return {
        audit: {
          id: parsed.data.id,
          pr_id: parsed.data.pr_id,
          commit_sha: parsed.data.commit_sha,
          status: parsed.data.status,
          attempts: parsed.data.attempts,
          max_attempts: parsed.data.max_attempts,
          worker_id: parsed.data.worker_id,
        },
        pullRequest: {
          id: pull.id,
          pr_number: pull.pr_number,
          head_sha: pull.head_sha,
          title: pull.title,
        },
        repository: pull.repositories,
      };
    },
  };
}

const processingContextSchema = z.object({
  id: z.string(),
  pr_id: z.string(),
  commit_sha: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  attempts: z.number().int(),
  max_attempts: z.number().int(),
  worker_id: z.string().nullable(),
  pull_requests: z
    .object({
      id: z.string(),
      pr_number: z.number().int(),
      head_sha: z.string(),
      title: z.string(),
      repositories: z.object({
        id: z.string(),
        user_id: z.string(),
        provider: z.enum(['github', 'gitlab', 'bitbucket']),
        owner: z.string(),
        repo_name: z.string(),
        provider_repository_id: z.string(),
      }),
    })
    .nullable(),
});

function one(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== 'object') {
    return null;
  }
  return row as Record<string, unknown>;
}

function nest(
  parent: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (!parent) {
    return null;
  }
  return { ...parent, [key]: one(parent[key]) };
}

function listRowToAudit(row: unknown): unknown {
  const record = (row ?? {}) as Record<string, unknown>;
  return {
    ...record,
    generated_documentation: '',
    token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    diff_bytes: null,
    analyzed_diff_bytes: null,
    files_changed: null,
    diff_omitted_files: [],
    attempts: 0,
    max_attempts: 1,
    worker_id: null,
    started_at: null,
    heartbeat_at: null,
    updated_at: record['created_at'],
  };
}

export const STALE_AUDIT_FAILURE_MESSAGE = RECOVERY_MESSAGE;

function unwrapBoolean(data: unknown): boolean {
  if (data === true) {
    return true;
  }
  if (Array.isArray(data)) {
    return unwrapBoolean(data[0]);
  }
  if (data && typeof data === 'object' && 'insert_audit_diff_if_owner' in data) {
    return data.insert_audit_diff_if_owner === true;
  }
  return false;
}
