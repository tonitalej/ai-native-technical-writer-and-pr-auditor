export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

export class UniqueViolationError extends Error {
  readonly pgCode = '23505' as const;

  constructor() {
    super('unique violation');
    this.name = 'UniqueViolationError';
  }
}

export class ForeignKeyViolationError extends Error {
  readonly pgCode = '23503' as const;

  constructor() {
    super('foreign key violation');
    this.name = 'ForeignKeyViolationError';
  }
}

/** Database failures that must not leak SQL or row contents to clients. */
export class QueryError extends Error {
  readonly pgCode: string;

  constructor(pgCode: string) {
    super('database query failed');
    this.name = 'QueryError';
    this.pgCode = pgCode;
  }
}

export class ProcessingTimeoutError extends Error {
  constructor() {
    super('audit processing deadline exceeded');
    this.name = 'ProcessingTimeoutError';
  }
}

export class FenceLostError extends Error {
  constructor() {
    super('audit claim is no longer current');
    this.name = 'FenceLostError';
  }
}

export class ActiveAuditCapError extends AppError {
  constructor() {
    super(
      429,
      'TOO_MANY_ACTIVE_AUDITS',
      'Too many audits are already in progress. Wait for one to finish.',
    );
  }
}

export function resourceNotFound(): AppError {
  return new AppError(404, 'RESOURCE_NOT_FOUND', 'Resource not found.');
}

export function unauthenticated(): AppError {
  return new AppError(401, 'UNAUTHENTICATED', 'Authentication is required.');
}

export function isUniqueViolation(error: unknown): error is UniqueViolationError {
  return error instanceof UniqueViolationError;
}

export function isForeignKeyViolation(error: unknown): error is ForeignKeyViolationError {
  return error instanceof ForeignKeyViolationError;
}
