import { ApiError } from '../api/errors';

export const AUDIT_POLL_FAST_MS = 2_000;
export const AUDIT_POLL_SLOW_MS = 5_000;
export const AUDIT_POLL_SLOW_AFTER_MS = 30_000;
export const AUDIT_POLL_CUTOFF_MS = 10 * 60 * 1000;
export const AUDIT_LIST_POLL_MS = 5_000;

export function isPollingBlocked(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 404);
}

export function auditPollDelay(status: string | undefined, elapsedMs: number, blocked: boolean): number | false {
  if (blocked) {
    return false;
  }
  if (status !== 'pending' && status !== 'running') {
    return false;
  }
  if (elapsedMs >= AUDIT_POLL_CUTOFF_MS) {
    return false;
  }
  return elapsedMs >= AUDIT_POLL_SLOW_AFTER_MS ? AUDIT_POLL_SLOW_MS : AUDIT_POLL_FAST_MS;
}

export function auditListPollDelay(hasActive: boolean, blocked: boolean): number | false {
  if (blocked || !hasActive) {
    return false;
  }
  return AUDIT_LIST_POLL_MS;
}
