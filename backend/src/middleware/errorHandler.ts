import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { AppError, UniqueViolationError } from '../utils/errors.js';
import type { AppLogger } from '../utils/logger.js';
import { redact } from '../utils/redact.js';

export function createErrorHandler(logger: AppLogger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const appError = toAppError(err);
    if (appError.statusCode >= 500) {
      logger.error(
        {
          request_id: req.requestId,
          code: appError.code,
          err: err instanceof Error ? { name: err.name, message: redact(err.message) } : { name: 'error' },
        },
        'request failed',
      );
    } else {
      logger.warn({ request_id: req.requestId, code: appError.code }, 'request rejected');
    }
    const body: {
      error: { code: string; message: string; details?: Record<string, unknown> };
    } = {
      error: {
        code: appError.code,
        message: appError.message,
      },
    };
    if (appError.details) {
      body.error.details = appError.details;
    }
    res.status(appError.statusCode).json(body);
  };
}

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err;
  }
  if (isHttpError(err, 413) || hasType(err, 'entity.too.large')) {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  }
  if (err instanceof SyntaxError || hasType(err, 'entity.parse.failed')) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }
  if (err instanceof UniqueViolationError) {
    return new AppError(409, 'CONFLICT', 'The request conflicts with an existing resource.');
  }
  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', {
      fields: [...new Set(err.issues.map((issue) => issue.path.join('.') || 'request'))],
    });
  }
  return new AppError(500, 'INTERNAL_ERROR', 'An internal error occurred.');
}

function isHttpError(err: unknown, status: number): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const value = err as { status?: unknown; statusCode?: unknown };
  return value.status === status || value.statusCode === status;
}

function hasType(err: unknown, type: string): boolean {
  return Boolean(err && typeof err === 'object' && 'type' in err && (err as { type?: unknown }).type === type);
}
