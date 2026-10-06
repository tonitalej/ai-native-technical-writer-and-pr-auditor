import type { AuditListRecord } from '../data/contracts.js';
import type { AuditRecord, PullRequestRecord, RepositoryRecord, UserRecord } from '../types/domain.js';

export function presentUser(user: UserRecord): UserRecord {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export function presentRepository(repository: RepositoryRecord): RepositoryRecord {
  return {
    id: repository.id,
    user_id: repository.user_id,
    provider: repository.provider,
    provider_repository_id: repository.provider_repository_id,
    owner: repository.owner,
    repo_name: repository.repo_name,
    repo_url: repository.repo_url,
    default_branch: repository.default_branch,
    is_private: repository.is_private,
    last_synced_at: repository.last_synced_at,
    created_at: repository.created_at,
    updated_at: repository.updated_at,
  };
}

export function presentPullRequest(pullRequest: PullRequestRecord): PullRequestRecord {
  return {
    id: pullRequest.id,
    repo_id: pullRequest.repo_id,
    pr_number: pullRequest.pr_number,
    provider_pr_id: pullRequest.provider_pr_id,
    title: pullRequest.title,
    author_login: pullRequest.author_login,
    html_url: pullRequest.html_url,
    base_branch: pullRequest.base_branch,
    head_branch: pullRequest.head_branch,
    head_sha: pullRequest.head_sha,
    state: pullRequest.state,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
    changed_files: pullRequest.changed_files,
    provider_created_at: pullRequest.provider_created_at,
    provider_updated_at: pullRequest.provider_updated_at,
    closed_at: pullRequest.closed_at,
    merged_at: pullRequest.merged_at,
    last_synced_at: pullRequest.last_synced_at,
    created_at: pullRequest.created_at,
    updated_at: pullRequest.updated_at,
  };
}

export function presentAuditListItem(audit: AuditListRecord) {
  return {
    id: audit.id,
    commit_sha: audit.commit_sha,
    status: audit.status,
    risk_level: audit.risk_level,
    summary: audit.summary,
    flag_count: audit.ai_security_flags.length,
    model: audit.model,
    prompt_version: audit.prompt_version,
    diff_truncated: audit.diff_truncated,
    duration_ms: audit.duration_ms,
    created_at: audit.created_at,
    completed_at: audit.completed_at,
    error_code: audit.error_code,
    error_message: audit.error_message,
  };
}

export function presentAudit(audit: AuditRecord): Record<string, unknown> {
  if (audit.status === 'completed') {
    return {
      id: audit.id,
      pr_id: audit.pr_id,
      commit_sha: audit.commit_sha,
      status: audit.status,
      risk_level: audit.risk_level,
      summary: audit.summary,
      generated_documentation: audit.generated_documentation,
      ai_security_flags: audit.ai_security_flags,
      model: audit.model,
      prompt_version: audit.prompt_version,
      token_usage: audit.token_usage,
      diff_bytes: audit.diff_bytes,
      analyzed_diff_bytes: audit.analyzed_diff_bytes,
      files_changed: audit.files_changed,
      diff_truncated: audit.diff_truncated,
      diff_omitted_files: audit.diff_omitted_files,
      duration_ms: audit.duration_ms,
      created_at: audit.created_at,
      completed_at: audit.completed_at,
    };
  }
  if (audit.status === 'failed') {
    return {
      id: audit.id,
      pr_id: audit.pr_id,
      commit_sha: audit.commit_sha,
      status: audit.status,
      error_code: audit.error_code,
      error_message: audit.error_message,
      duration_ms: audit.duration_ms,
      created_at: audit.created_at,
      completed_at: audit.completed_at,
    };
  }
  return {
    id: audit.id,
    pr_id: audit.pr_id,
    commit_sha: audit.commit_sha,
    status: audit.status,
    created_at: audit.created_at,
  };
}
