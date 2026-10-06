import type { ZodType } from 'zod';

import { errorDetailsSchema, paginationSchema, type Pagination } from '../types/api';
import { getAuthBridge } from './authBridge';
import { ApiError, ResponseShapeError } from './errors';

const REQUEST_TIMEOUT_MS = 30_000;

let apiBase = 'http://localhost:3000';

export function setApiBase(url: string): void {
  apiBase = url.replace(/\/$/, '');
}

export function getApiBase(): string {
  return apiBase;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<{
  data: T;
  pagination: Pagination | null;
  requestId: string | null;
  status: number;
}> {
  const token = await getAuthBridge().getAccessToken();
  if (!token) {
    throw new ApiError({
      status: 401,
      code: 'UNAUTHENTICATED',
      message: 'Authentication is required.',
      requestId: null,
    });
  }
  try {
    return await send(path, schema, options, token, false);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || error.code !== 'UNAUTHENTICATED') {
      throw error;
    }
    const refreshed = await getAuthBridge().refreshAccessToken();
    if (!refreshed) {
      await getAuthBridge().signOut();
      throw error;
    }
    try {
      return await send(path, schema, options, refreshed, true);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 401) {
        await getAuthBridge().signOut();
      }
      throw retryError;
    }
  }
}

async function send<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestOptions,
  token: string,
  _retried: boolean,
): Promise<{ data: T; pagination: Pagination | null; requestId: string | null; status: number }> {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK',
      message: 'The network request failed.',
      requestId: null,
    });
  }

  const requestId = readRequestId(response);
  if (response.status === 204) {
    const parsed = schema.safeParse(undefined);
    if (!parsed.success) {
      throw new ResponseShapeError(requestId);
    }
    return { data: parsed.data, pagination: null, requestId, status: 204 };
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw toApiError(response, payload, requestId);
  }
  if (!payload || typeof payload !== 'object' || !('data' in payload)) {
    throw new ResponseShapeError(requestId);
  }
  const record = payload as { data: unknown; pagination?: unknown };
  const parsed = schema.safeParse(record.data);
  if (!parsed.success) {
    throw new ResponseShapeError(requestId);
  }
  let pagination: Pagination | null = null;
  if (record.pagination !== undefined) {
    const page = paginationSchema.safeParse(record.pagination);
    if (!page.success) {
      throw new ResponseShapeError(requestId);
    }
    pagination = page.data;
  }
  return { data: parsed.data, pagination, requestId, status: response.status };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toApiError(response: Response, payload: unknown, requestId: string | null): ApiError {
  const retryAfterSeconds = parseRetryAfter(response.headers.get('Retry-After'));
  const body = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
  if (!body || typeof body !== 'object') {
    return new ApiError({
      status: response.status,
      code: 'UNKNOWN',
      message: 'The request failed.',
      requestId,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  const record = body as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof record.code === 'string' ? record.code : 'UNKNOWN';
  const message = typeof record.message === 'string' ? record.message : 'The request failed.';
  const detailsParsed = errorDetailsSchema.safeParse(record.details);
  return new ApiError({
    status: response.status,
    code,
    message,
    requestId,
    ...(detailsParsed.success ? { details: detailsParsed.data } : {}),
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) {
    return undefined;
  }
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function readRequestId(response: Response): string | null {
  const value = response.headers.get('X-Request-Id');
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
