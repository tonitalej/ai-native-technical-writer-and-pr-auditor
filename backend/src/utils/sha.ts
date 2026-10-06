import { AppError } from './errors.js';

const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Lowercase a commit SHA and reject placeholders, including the all-zero SHA.
 * Throws a client-safe validation error when the provider value is unusable.
 */
export function normalizeSha(sha: string): string {
  const normalized = sha.trim().toLowerCase();
  if (!SHA_PATTERN.test(normalized) || /^0+$/.test(normalized)) {
    throw new AppError(422, 'VALIDATION_ERROR', 'The provider returned an invalid commit SHA.');
  }
  return normalized;
}
