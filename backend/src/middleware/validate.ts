import { z } from 'zod';

import { AppError } from '../utils/errors.js';

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  return parse(schema, body);
}

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return parse(schema, normalizeQuery(query));
}

export function parseUuid(value: unknown, field: string): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = z.string().uuid().safeParse(candidate);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', {
      fields: [field],
    });
  }
  return parsed.data;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Request validation failed.', {
      fields: uniquePaths(parsed.error.issues.map((issue) => issue.path.join('.') || 'request')),
    });
  }
  return parsed.data;
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

function normalizeQuery(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object') {
    return {};
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    output[key] = Array.isArray(value) ? value[0] : value;
  }
  return output;
}
