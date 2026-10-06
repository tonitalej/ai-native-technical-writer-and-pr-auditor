import { QueryClient } from '@tanstack/react-query';

import { ApiError, ResponseShapeError } from '../api/errors';

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) {
    return false;
  }
  if (error instanceof ResponseShapeError) {
    return false;
  }
  if (error instanceof ApiError) {
    return error.status >= 500;
  }
  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: shouldRetry,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
