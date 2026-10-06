const OMITTED_REASONS: Record<string, string> = {
  size_budget: 'Size limit',
  no_patch: 'No patch available',
  binary: 'Binary',
  fetch_cap: 'Fetch limit',
};

export function omittedReasonLabel(reason: string): string {
  return OMITTED_REASONS[reason] ?? reason;
}

export function friendlyAuditFailure(code: string | null, backendMessage: string | null): string {
  switch (code) {
    case 'HEAD_SHA_CHANGED':
      return 'The pull request was updated while the audit ran.';
    case 'DIFF_EMPTY':
      return 'This pull request has no changes to analyze.';
    case 'DIFF_TOO_LARGE':
      return 'This pull request is too large to analyze.';
    case 'PROVIDER_CREDENTIAL_INVALID':
      return 'The stored GitHub token no longer works.';
    case 'PROVIDER_PERMISSION_DENIED':
      return 'The GitHub token lacks the required permissions (Pull requests: Read, Contents: Read).';
    case 'PROVIDER_RESOURCE_NOT_FOUND':
      return 'GitHub could not find that repository or pull request, or the token cannot see it.';
    case 'PROVIDER_RATE_LIMITED':
      return 'GitHub is rate limiting requests. Try again shortly.';
    case 'PROVIDER_UNAVAILABLE':
      return 'GitHub is unreachable right now.';
    case 'AI_REFUSED':
    case 'AI_OUTPUT_TRUNCATED':
    case 'AI_INVALID_OUTPUT':
    case 'AI_UNAVAILABLE':
      return 'The AI step failed.';
    case 'AUDIT_PROCESSING_TIMEOUT':
      return 'This audit took too long and was stopped.';
    case 'REPOSITORY_ACCESS_LOST':
      return 'The repository is no longer accessible.';
    case 'AUDIT_ATTEMPTS_EXHAUSTED':
      return 'The audit was interrupted repeatedly. Start a new one.';
    default:
      return backendMessage?.trim() || 'The audit failed.';
  }
}

export function failureAction(code: string | null): 'start' | 'reconnect' | 'none' {
  switch (code) {
    case 'HEAD_SHA_CHANGED':
    case 'AI_REFUSED':
    case 'AI_OUTPUT_TRUNCATED':
    case 'AI_INVALID_OUTPUT':
    case 'AI_UNAVAILABLE':
    case 'AUDIT_PROCESSING_TIMEOUT':
    case 'AUDIT_ATTEMPTS_EXHAUSTED':
    case 'PROVIDER_RATE_LIMITED':
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_RESOURCE_NOT_FOUND':
      return 'start';
    case 'PROVIDER_CREDENTIAL_INVALID':
    case 'PROVIDER_PERMISSION_DENIED':
      return 'reconnect';
    default:
      return 'none';
  }
}

export function presentApiError(error: { status: number; code: string; message: string; details?: { fields?: string[] } }): string {
  if (error.status >= 500 && error.code !== 'PROVIDER_UNAVAILABLE') {
    return 'Something went wrong. Try again.';
  }
  if (error.code === 'VALIDATION_ERROR') {
    const fields = error.details?.fields?.filter(Boolean) ?? [];
    if (fields.length > 0) {
      return `${error.message} (${fields.join(', ')})`;
    }
    return error.message || 'Check the form and try again.';
  }
  return apiErrorMessage(error.code, error.message);
}

export function apiErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'TOO_MANY_ACTIVE_AUDITS':
      return "You've reached your limit of active audits. Wait for one to finish, then try again.";
    case 'PROVIDER_RESOURCE_NOT_FOUND':
      return 'GitHub could not find that repository or pull request, or the token cannot see it.';
    case 'PROVIDER_CREDENTIAL_INVALID':
      return 'The stored GitHub token no longer works.';
    case 'PROVIDER_PERMISSION_DENIED':
      return 'The GitHub token lacks the required permissions (Pull requests: Read, Contents: Read).';
    case 'PROVIDER_RATE_LIMITED':
      return 'GitHub is rate limiting requests. Try again shortly.';
    case 'PROVIDER_UNAVAILABLE':
      return 'GitHub is unreachable right now.';
    case 'RESOURCE_NOT_FOUND':
      return 'Not found.';
    case 'RATE_LIMITED':
      return fallback || 'Too many requests. Please try again later.';
    case 'GITHUB_TOKEN_INVALID':
      return 'This GitHub token was rejected. Check the token and try again.';
    default:
      if (code === 'INTERNAL_ERROR' || !fallback) {
        return 'Something went wrong. Try again.';
      }
      return fallback;
  }
}
