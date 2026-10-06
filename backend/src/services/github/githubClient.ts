import { z } from 'zod';

import { GITHUB_ERROR_BODY_MAX_BYTES, GITHUB_JSON_MAX_BYTES, GITHUB_USER_AGENT } from '../../config/constants.js';
import { AppError } from '../../utils/errors.js';
import { BodyTooLargeError, decodeUtf8, readBodyWithCap } from './readBody.js';

export type CredentialSource = 'connect' | 'stored';

export interface GitHubClientOptions {
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  token: string;
  credentialSource: CredentialSource;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

interface RequestOptions {
  accept?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number>;
  /** Statuses whose body the caller still needs to read. They are not mapped here. */
  passThroughStatuses?: number[];
}

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export function classifyGitHubStatus(input: {
  status: number;
  rateLimitRemaining: string | null;
  retryAfterSeconds: number | null;
  bodySample: string;
  credentialSource: CredentialSource;
}): { retryable: boolean; waitMs: number; error: AppError } {
  const { status, credentialSource } = input;
  const rateLimited = isRateLimitResponse(input);

  if (status === 410) {
    return {
      retryable: false,
      waitMs: 0,
      error: new AppError(
        502,
        'PROVIDER_UNAVAILABLE',
        'The pinned GitHub API version was rejected. Update GITHUB_API_VERSION.',
      ),
    };
  }

  if (status === 401) {
    if (credentialSource === 'connect') {
      return {
        retryable: false,
        waitMs: 0,
        error: new AppError(422, 'GITHUB_TOKEN_INVALID', 'The GitHub token was rejected.'),
      };
    }
    return {
      retryable: false,
      waitMs: 0,
      error: new AppError(
        409,
        'PROVIDER_CREDENTIAL_INVALID',
        'The stored GitHub token is no longer valid. Reconnect the repository with a new token.',
      ),
    };
  }

  if (rateLimited) {
    const waitMs =
      input.retryAfterSeconds !== null && input.retryAfterSeconds >= 0
        ? Math.ceil(input.retryAfterSeconds * 1000)
        : Number.POSITIVE_INFINITY;
    const retryable = waitMs <= 10_000;
    return {
      retryable,
      waitMs: retryable ? waitMs : 0,
      error: new AppError(429, 'PROVIDER_RATE_LIMITED', 'GitHub rate-limited the request. Try again later.'),
    };
  }

  if (status === 403) {
    return {
      retryable: false,
      waitMs: 0,
      error: new AppError(
        409,
        'PROVIDER_PERMISSION_DENIED',
        'The GitHub token does not have permission to read this resource.',
      ),
    };
  }

  if (status === 404) {
    return {
      retryable: false,
      waitMs: 0,
      error: new AppError(404, 'PROVIDER_RESOURCE_NOT_FOUND', 'The GitHub resource was not found.'),
    };
  }

  if (RETRYABLE_STATUSES.has(status)) {
    return {
      retryable: true,
      waitMs: 0,
      error: new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.'),
    };
  }

  return {
    retryable: false,
    waitMs: 0,
    error: new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.'),
  };
}

export function retryAfterSeconds(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return Math.max(0, (asDate - Date.now()) / 1000);
    }
  }
  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const resetSeconds = Number(reset);
    if (Number.isFinite(resetSeconds)) {
      return resetSeconds - Date.now() / 1000;
    }
  }
  return null;
}

function isRateLimitResponse(input: {
  status: number;
  rateLimitRemaining: string | null;
  bodySample: string;
}): boolean {
  if (input.status === 429) {
    return true;
  }
  if (input.status !== 403) {
    return false;
  }
  if (input.rateLimitRemaining === '0') {
    return true;
  }
  const sample = input.bodySample.toLowerCase();
  return sample.includes('rate limit') || sample.includes('secondary rate');
}

export class GitHubClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GitHubClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async requestJson<T>(path: string, schema: z.ZodType<T>, request?: RequestOptions): Promise<T> {
    const response = await this.request(path, {
      ...request,
      accept: request?.accept ?? 'application/vnd.github+json',
    });
    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }
    const bytes = await readBodyWithCap(response, GITHUB_JSON_MAX_BYTES, request?.signal).catch(
      (error: unknown) => {
        if (error instanceof BodyTooLargeError) {
          throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub returned a response that was too large.');
        }
        throw error;
      },
    );
    let json: unknown;
    try {
      json = JSON.parse(decodeUtf8(bytes)) as unknown;
    } catch {
      throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub returned an unexpected response.');
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub returned an unexpected response.');
    }
    return parsed.data;
  }

  /** Returns the raw response after retries. The caller enforces the body cap. */
  async request(path: string, request?: RequestOptions): Promise<Response> {
    const accept = request?.accept ?? 'application/vnd.github+json';
    let lastError: AppError | null = null;

    for (let attempt = 0; attempt <= 2; attempt += 1) {
      if (request?.signal?.aborted) {
        throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
      }
      let response: Response;
      try {
        response = await this.fetchOnce(path, accept, request);
      } catch (error) {
        if (request?.signal?.aborted) {
          throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
        }
        if (isTimeoutOrAbort(error) || !isNetworkError(error) || attempt === 2) {
          throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
        }
        await delay(200 * (attempt + 1), request?.signal);
        continue;
      }

      if (response.ok || (request?.passThroughStatuses ?? []).includes(response.status)) {
        return response;
      }

      const sample = await readErrorSample(response);
      const decision = classifyGitHubStatus({
        status: response.status,
        rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
        retryAfterSeconds: retryAfterSeconds(response.headers),
        bodySample: sample,
        credentialSource: this.options.credentialSource,
      });
      lastError = decision.error;
      if (!decision.retryable || attempt === 2) {
        throw decision.error;
      }
      const waitMs = decision.waitMs > 0 ? decision.waitMs : 200 * (attempt + 1);
      await delay(waitMs, request?.signal);
    }

    throw lastError ?? new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
  }

  private async fetchOnce(path: string, accept: string, request?: RequestOptions): Promise<Response> {
    const url = new URL(path.startsWith('http') ? path : `${this.options.baseUrl}${path}`);
    if (request?.query) {
      for (const [key, value] of Object.entries(request.query)) {
        url.searchParams.set(key, String(value));
      }
    }
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const signal = request?.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    return this.fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: accept,
        'X-GitHub-Api-Version': this.options.apiVersion,
        'User-Agent': this.options.userAgent ?? GITHUB_USER_AGENT,
      },
      signal,
    });
  }

  private async errorFromResponse(response: Response): Promise<AppError> {
    const sample = await readErrorSample(response);
    return classifyGitHubStatus({
      status: response.status,
      rateLimitRemaining: response.headers.get('x-ratelimit-remaining'),
      retryAfterSeconds: retryAfterSeconds(response.headers),
      bodySample: sample,
      credentialSource: this.options.credentialSource,
    }).error;
  }
}

async function readErrorSample(response: Response): Promise<string> {
  try {
    const bytes = await readBodyWithCap(response, GITHUB_ERROR_BODY_MAX_BYTES);
    return decodeUtf8(bytes);
  } catch {
    return '';
  }
}

function isTimeoutOrAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.name === 'FetchError');
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function hasNextLink(linkHeader: string | null): boolean {
  if (!linkHeader) {
    return false;
  }
  return linkHeader.split(',').some((part) => part.includes('rel="next"'));
}

export function isDiffTooLargeResponse(status: number, bodySample: string): boolean {
  if (status === 406) {
    return true;
  }
  if (status !== 422) {
    return false;
  }
  const sample = bodySample.toLowerCase();
  return (
    sample.includes('diff') &&
    (sample.includes('too large') ||
      sample.includes('too big') ||
      sample.includes('exceeded') ||
      sample.includes('too many'))
  );
}
