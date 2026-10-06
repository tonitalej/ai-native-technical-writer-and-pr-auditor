import { AppError, FenceLostError, ProcessingTimeoutError } from '../../utils/errors.js';

export const AUDIT_ERROR_MESSAGES = {
  HEAD_SHA_CHANGED: 'The pull request was updated while the audit was running. Start a new audit.',
  DIFF_EMPTY: 'The pull request diff is empty, so there is nothing to analyze.',
  DIFF_TOO_LARGE: 'The pull request diff is too large to analyze.',
  PROVIDER_CREDENTIAL_INVALID:
    'The stored GitHub token is no longer valid. Reconnect the repository with a new token.',
  PROVIDER_PERMISSION_DENIED: 'The GitHub token does not have permission to read this pull request.',
  PROVIDER_RESOURCE_NOT_FOUND: 'The pull request could not be found on GitHub.',
  PROVIDER_RATE_LIMITED: 'GitHub rate-limited the request. Try again later.',
  PROVIDER_UNAVAILABLE: 'GitHub is temporarily unavailable. Try again later.',
  AI_REFUSED: 'The model refused to analyze this pull request.',
  AI_OUTPUT_TRUNCATED: 'The model output was truncated before it could be validated.',
  AI_INVALID_OUTPUT: 'The model returned output that did not match the required schema.',
  AI_UNAVAILABLE: 'The AI provider is temporarily unavailable. Try again later.',
  REPOSITORY_ACCESS_LOST: 'The repository is no longer accessible with the stored token.',
  AUDIT_ATTEMPTS_EXHAUSTED:
    'The audit was interrupted repeatedly and was stopped. Please start a new audit.',
  AUDIT_PROCESSING_TIMEOUT: 'The audit exceeded the maximum processing time.',
  INTERNAL_ERROR: 'The audit failed because of an internal error.',
} as const;

export type AuditErrorCode = keyof typeof AUDIT_ERROR_MESSAGES;

const CODES = new Set<string>(Object.keys(AUDIT_ERROR_MESSAGES));

export function isAuditErrorCode(code: string): code is AuditErrorCode {
  return CODES.has(code);
}

export function auditFailure(code: AuditErrorCode, statusCode = 422): AppError {
  return new AppError(statusCode, code, AUDIT_ERROR_MESSAGES[code]);
}

export function auditErrorCodeFrom(error: unknown, signal?: AbortSignal): AuditErrorCode {
  if (signal?.reason instanceof ProcessingTimeoutError || error instanceof ProcessingTimeoutError) {
    return 'AUDIT_PROCESSING_TIMEOUT';
  }
  if (error instanceof FenceLostError) {
    return 'INTERNAL_ERROR';
  }
  if (error instanceof AppError && isAuditErrorCode(error.code)) {
    return error.code;
  }
  return 'INTERNAL_ERROR';
}
