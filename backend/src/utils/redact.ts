/**
 * High-confidence secret redaction. This is best-effort pattern matching:
 * it catches known token shapes and does not claim to find every secret.
 */
const REPLACEMENTS: ReadonlyArray<{ type: string; pattern: RegExp }> = [
  {
    type: 'private-key',
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  },
  {
    type: 'github-token',
    pattern: /github_pat_[A-Za-z0-9_]{20,}(?![A-Za-z0-9_])|gh[pousr]_[A-Za-z0-9]{20,}(?![A-Za-z0-9])/g,
  },
  {
    type: 'aws-access-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    type: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  },
  {
    type: 'api-key',
    pattern: /\bsk-[A-Za-z0-9_-]{20,}/g,
  },
  {
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
];

export function redact(input: string): string {
  let output = input;
  for (const { type, pattern } of REPLACEMENTS) {
    output = output.replace(new RegExp(pattern.source, pattern.flags), `[REDACTED:${type}]`);
  }
  return output;
}

export function sanitizeErrorMessage(message: string): string {
  const cleaned = redact(message).replace(/\s+/g, ' ').trim().slice(0, 500);
  return cleaned.length > 0 ? cleaned : 'The audit failed.';
}

const SENSITIVE_KEYS = new Set([
  'token',
  'password',
  'authorization',
  'ciphertext',
  'raw_diff',
  'diff',
  'credential',
  'secret',
  'api_key',
  'apikey',
  'openai_api_key',
  'credential_encryption_key',
  'supabase_secret_key',
  'supabase_service_role_key',
]);

/** Recursively redact strings and drop known secret fields before logging. */
export function sanitizeForLog(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') {
    return redact(value);
  }
  if (depth > 6 || value === null || typeof value !== 'object') {
    return typeof value === 'string' ? redact(value) : value;
  }
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLog(item, seen, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      output[key] = '[Redacted]';
    } else {
      output[key] = sanitizeForLog(nested, seen, depth + 1);
    }
  }
  return output;
}
