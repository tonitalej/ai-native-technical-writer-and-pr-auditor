import type { Audit, AuditListItem, PullRequest, Repository, User } from '../src/types/api';

export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const REPO_ID = '11111111-1111-4111-8111-111111111111';
export const PR_ID = '33333333-3333-4333-8333-333333333333';
export const AUDIT_ID = '44444444-4444-4444-8444-444444444444';
export const SHA = 'a'.repeat(40);

export const user: User = {
  id: USER_ID,
  email: 'ada@example.com',
  display_name: 'Ada',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export function repository(overrides: Partial<Repository> = {}): Repository {
  return {
    id: REPO_ID,
    user_id: USER_ID,
    provider: 'github',
    provider_repository_id: '1',
    owner: 'octocat',
    repo_name: 'hello',
    repo_url: 'https://github.com/octocat/hello',
    default_branch: 'main',
    is_private: true,
    last_synced_at: '2026-01-02T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

export function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: PR_ID,
    repo_id: REPO_ID,
    pr_number: 7,
    provider_pr_id: '70',
    title: 'Add audit trail',
    author_login: 'ada',
    html_url: 'https://github.com/octocat/hello/pull/7',
    base_branch: 'main',
    head_branch: 'feature',
    head_sha: SHA,
    state: 'open',
    additions: 10,
    deletions: 2,
    changed_files: 3,
    provider_created_at: '2026-01-02T00:00:00.000Z',
    provider_updated_at: '2026-01-03T00:00:00.000Z',
    closed_at: null,
    merged_at: null,
    last_synced_at: '2026-01-03T00:00:00.000Z',
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

export function auditListItem(overrides: Partial<AuditListItem> = {}): AuditListItem {
  return {
    id: AUDIT_ID,
    commit_sha: SHA,
    status: 'completed',
    risk_level: 'low',
    summary: 'Small change.',
    flag_count: 1,
    model: 'gpt-test',
    prompt_version: 'v1',
    diff_truncated: false,
    duration_ms: 83000,
    created_at: '2026-01-03T00:00:00.000Z',
    completed_at: '2026-01-03T00:01:00.000Z',
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

export function completedAudit(overrides: Partial<Extract<Audit, { status: 'completed' }>> = {}): Extract<Audit, { status: 'completed' }> {
  return {
    id: AUDIT_ID,
    pr_id: PR_ID,
    commit_sha: SHA,
    status: 'completed',
    risk_level: 'high',
    summary: 'A secret was added.',
    generated_documentation: '## What changed\n\nThe handler now checks tokens.',
    ai_security_flags: [
      {
        severity: 'high',
        confidence: 'confirmed',
        category: 'hardcoded-secret',
        title: 'Token in source',
        description: 'A token is committed.',
        file: 'src/app.ts',
        line: 4,
        recommendation: 'Remove the token.',
      },
      {
        severity: 'info',
        confidence: 'potential',
        category: 'other',
        title: 'Worth a look',
        description: 'Naming is unclear.',
        file: null,
        line: null,
        recommendation: 'Rename the helper.',
      },
    ],
    model: 'gpt-test',
    prompt_version: 'v1',
    token_usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    diff_bytes: 2048,
    analyzed_diff_bytes: 1024,
    files_changed: 2,
    diff_truncated: true,
    diff_omitted_files: [{ path: 'package-lock.json', reason: 'size_budget' }],
    duration_ms: 83000,
    created_at: '2026-01-03T00:00:00.000Z',
    completed_at: '2026-01-03T00:01:00.000Z',
    ...overrides,
  };
}
