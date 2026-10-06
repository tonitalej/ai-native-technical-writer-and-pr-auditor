import {
  ActiveAuditCapError,
  ForeignKeyViolationError,
  QueryError,
  UniqueViolationError,
  resourceNotFound,
} from '../utils/errors.js';

export interface PostgrestLikeError {
  code?: string;
  message?: string;
}

export function raiseDatabaseError(error: PostgrestLikeError | null): void {
  if (!error) {
    return;
  }
  if (error.code === '23505') {
    throw new UniqueViolationError();
  }
  if (error.code === '23503') {
    throw new ForeignKeyViolationError();
  }
  if (error.code === 'P0001' && (error.message ?? '').includes('TOO_MANY_ACTIVE_AUDITS')) {
    throw new ActiveAuditCapError();
  }
  if (error.code === 'P0002') {
    throw resourceNotFound();
  }
  throw new QueryError(error.code ?? 'unknown');
}

export function unwrapRow(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data[0] ?? null;
  }
  return data ?? null;
}
