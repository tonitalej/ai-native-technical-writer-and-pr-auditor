import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { UserData } from '../data/contracts.js';
import type { AuthUser } from '../types/domain.js';
import { unauthenticated } from '../utils/errors.js';
import type { AppLogger } from '../utils/logger.js';

export interface AuthVerifier {
  verify(
    token: string,
  ): Promise<
    | { ok: true; user: AuthUser }
    | { ok: false; reason: 'invalid' | 'expired' }
  >;
}

export function createSupabaseAuthVerifier(client: SupabaseClient): AuthVerifier {
  return {
    async verify(token: string) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) {
        const message = error?.message?.toLowerCase() ?? '';
        return { ok: false, reason: message.includes('expired') ? 'expired' : 'invalid' };
      }
      return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
    },
  };
}

export function createRequireAuth(
  auth: AuthVerifier,
  users: UserData,
  logger: AppLogger,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('authorization');
    if (!header) {
      logger.warn({ request_id: req.requestId, reason: 'missing_header' }, 'authentication failed');
      next(unauthenticated());
      return;
    }
    const match = /^Bearer (\S+)$/i.exec(header);
    const token = match?.[1];
    if (!token) {
      logger.warn({ request_id: req.requestId, reason: 'malformed_header' }, 'authentication failed');
      next(unauthenticated());
      return;
    }
    void auth
      .verify(token)
      .then(async (result) => {
        if (!result.ok) {
          logger.warn({ request_id: req.requestId, reason: result.reason }, 'authentication failed');
          next(unauthenticated());
          return;
        }
        await users.ensureUser(result.user.id, result.user.email);
        req.user = result.user;
        next();
      })
      .catch(next);
  };
}
