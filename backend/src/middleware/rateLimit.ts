import type { NextFunction } from 'express';
import rateLimit, { type Options, type RateLimitRequestHandler } from 'express-rate-limit';
import type { Request, Response } from 'express';

export interface RateLimitSettings {
  windowMs: number;
  limit: number;
}

function sendRateLimited(_req: Request, res: Response, _next: NextFunction, options: Options): void {
  const seconds = Math.max(1, Math.ceil(options.windowMs / 1000));
  res.setHeader('Retry-After', String(seconds));
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  });
}

export function createGeneralLimiter(settings: RateLimitSettings): RateLimitRequestHandler {
  return rateLimit({
    windowMs: settings.windowMs,
    limit: settings.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    handler: sendRateLimited,
  });
}

export function createUserLimiter(settings: RateLimitSettings): RateLimitRequestHandler {
  return rateLimit({
    windowMs: settings.windowMs,
    limit: settings.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anonymous',
    validate: { keyGeneratorIpFallback: false },
    handler: sendRateLimited,
  });
}

/** Counts HTTP 401 responses per IP. Successful and non-auth failures are not counted. */
export function createAuthFailureLimiter(settings: RateLimitSettings): RateLimitRequestHandler {
  return rateLimit({
    windowMs: settings.windowMs,
    limit: settings.limit,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 401,
    handler: sendRateLimited,
  });
}
