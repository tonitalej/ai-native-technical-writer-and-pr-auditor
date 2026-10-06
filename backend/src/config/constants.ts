/** In-process rate limits. Horizontal scaling needs a shared store (see README). */
export const RATE_LIMITS = {
  general: { windowMs: 15 * 60 * 1000, limit: 300 },
  /** Repository connect and sync, per authenticated user. */
  connect: { windowMs: 15 * 60 * 1000, limit: 10 },
  /** Audit creation, per authenticated user. */
  auditCreate: { windowMs: 60 * 60 * 1000, limit: 10 },
  /**
   * Failed authentication attempts per IP.
   * The spec requires a stricter limiter than the general API limit and does not
   * fix the number; 30 failures / 15 min is the V1 choice.
   */
  authFailure: { windowMs: 15 * 60 * 1000, limit: 30 },
} as const;

export const GITHUB_USER_AGENT = 'ai-native-pr-auditor/1.0';
export const GITHUB_SYNC_PER_PAGE = 100;
export const GITHUB_FILES_PER_PAGE = 100;
export const GITHUB_FILES_MAX_PAGES = 30;
export const GITHUB_JSON_MAX_BYTES = 5_000_000;
export const GITHUB_ERROR_BODY_MAX_BYTES = 8_192;

export const PR_UPSERT_BATCH_SIZE = 100;

export const DIFF_OMITTED_FILES_CAP = 200;
export const DIFF_NOTICE_LIST_LIMIT = 20;

/** How often the worker runs stale recovery, in addition to startup. */
export const AUDIT_RECOVERY_INTERVAL_MS = 30_000;

export const CURRENT_ENCRYPTION_KEY_ID = 'app-v1';

export const DEV_CORS_ORIGIN = 'http://localhost:5173';

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
