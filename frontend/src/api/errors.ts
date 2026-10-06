import type { ErrorDetails } from '../types/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly retryAfterSeconds?: number;
  readonly requestId: string | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetails;
    retryAfterSeconds?: number;
    requestId: string | null;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId;
    if (input.details !== undefined) {
      this.details = input.details;
    }
    if (input.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = input.retryAfterSeconds;
    }
  }
}

/** The JSON parsed, but it did not match the schema. Shown to the developer, not thrown past React Query. */
export class ResponseShapeError extends Error {
  readonly requestId: string | null;

  constructor(requestId: string | null) {
    super('The app received a response it could not read.');
    this.name = 'ResponseShapeError';
    this.requestId = requestId;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
