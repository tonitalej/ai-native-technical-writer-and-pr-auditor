import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { friendlyAuditFailure } from '../../src/lib/auditCopy';
import { AuditFailure } from '../../src/components/audits/AuditPanels';
import { AUDIT_ID, PR_ID, REPO_ID, SHA, completedAudit, pullRequest, repository } from '../fixtures';
import { createFakeAuth, renderAt, session } from '../helpers';
import { db } from '../mocks/handlers';
import { server } from '../mocks/server';

describe('auth routes', () => {
  it('sends anonymous visitors to sign in and signed-in visitors away from it', async () => {
    renderAt('/repositories', createFakeAuth({ session: null }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
    cleanup();
    renderAt('/login', createFakeAuth());
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeTruthy();
  });

  it('shows the confirmation message when sign up returns no session, and enters when it does', async () => {
    const user = userEvent.setup();
    renderAt('/signup', createFakeAuth({ session: null, signupSession: null }));
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Check your email to confirm your account' })).toBeTruthy();
    cleanup();

    const signedUp = createFakeAuth({ session: null, signupSession: session });
    renderAt('/signup', signedUp);
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Display name (optional)'), 'Ada');
    await user.type(screen.getByLabelText('Password'), 'long-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('heading', { name: 'Repositories' })).toBeTruthy();
    expect(signedUp.lastSignup()).toMatchObject({ options: { data: { display_name: 'Ada' } } });
  });

  it('uses a neutral sign-in error and clears the cache on sign out', async () => {
    const user = userEvent.setup();
    renderAt('/login', createFakeAuth({ session: null, signInError: true }));
    await user.type(await screen.findByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid email or password')).toBeTruthy();
    cleanup();

    const auth = createFakeAuth();
    const view = renderAt('/repositories', auth);
    view.queryClient.setQueryData(['secret-cache'], { token: 'should-go' });
    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(auth.signedOut()).toBe(true));
    expect(view.queryClient.getQueryData(['secret-cache'])).toBeUndefined();
  });
});

describe('repositories', () => {
  it('lists repositories, paginates, and requires the typed name before delete', async () => {
    db.repos = Array.from({ length: 21 }, (_, index) =>
      repository({
        id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
        repo_name: `repo-${index + 1}`,
      }),
    );
    const user = userEvent.setup();
    renderAt('/repositories');
    expect(await screen.findByText('octocat/repo-1')).toBeTruthy();
    expect(screen.queryByText('octocat/repo-21')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('octocat/repo-21')).toBeTruthy();
    cleanup();

    db.repos = [repository()];
    renderAt('/repositories');
    await user.click(await screen.findByRole('button', { name: 'Delete repository' }));
    const confirm = screen.getByRole('button', { name: 'Delete' });
    expect(confirm).toHaveProperty('disabled', true);
    await user.type(screen.getByLabelText('Repository name'), 'octocat/hello');
    expect(confirm).toHaveProperty('disabled', false);
    await user.click(confirm);
    await waitFor(() => expect(screen.getByText('No repositories yet')).toBeTruthy());
  });

  it('connects a new repository, rotates an existing one, and clears the token', async () => {
    db.repos = [];
    const user = userEvent.setup();
    const view = renderAt('/repositories');
    await user.click((await screen.findAllByRole('button', { name: 'Connect repository' }))[0]!);
    await user.type(screen.getByLabelText('Repository'), 'octocat/hello');
    await user.type(screen.getByLabelText('GitHub token'), 'ghp_supersecretvalue');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Repository connected')).toBeTruthy();
    expect(screen.queryByDisplayValue('ghp_supersecretvalue')).toBeNull();
    expect(JSON.stringify(view.queryClient.getQueryCache())).not.toContain('ghp_supersecretvalue');
    expect(JSON.stringify(view.queryClient.getMutationCache())).not.toContain('ghp_supersecretvalue');
    cleanup();

    db.repos = [repository()];
    db.connectStatus = 200;
    renderAt('/repositories');
    await user.click((await screen.findAllByRole('button', { name: 'Connect repository' }))[0]!);
    await user.type(screen.getByLabelText('Repository'), 'octocat/hello');
    await user.type(screen.getByLabelText('GitHub token'), 'ghp_rotated');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Repository already connected. Token updated.')).toBeTruthy();
  });

  it('shows an invalid token under the token field', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('http://localhost:3000/api/repositories', () =>
        HttpResponse.json(
          { error: { code: 'GITHUB_TOKEN_INVALID', message: 'The GitHub token was rejected.' } },
          { status: 422, headers: { 'X-Request-Id': 'req-token' } },
        ),
      ),
    );
    renderAt('/repositories');
    await user.click((await screen.findAllByRole('button', { name: 'Connect repository' }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Enter a repository.')).toBeTruthy();
    await user.type(screen.getByLabelText('Repository'), 'octocat/hello');
    await user.type(screen.getByLabelText('GitHub token'), 'bad-token');
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    const tokenError = await screen.findByText(/this github token was rejected/i);
    expect(tokenError.id).toBe('token-error');
    expect((screen.getByLabelText('GitHub token') as HTMLInputElement).value).toBe('');
  });
});

describe('sync and pull requests', () => {
  it('shows the sync count, a truncation warning, and a reconnect banner', async () => {
    const user = userEvent.setup();
    db.sync = { synced: 2, truncated: true, last_synced_at: '2026-01-04T00:00:00.000Z' };
    renderAt(`/repositories/${REPO_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('Synced 2 pull requests')).toBeTruthy();
    expect(screen.getByText('Only the most recently updated pull requests were synced.')).toBeTruthy();

    server.use(
      http.post(`http://localhost:3000/api/repositories/${REPO_ID}/sync`, () =>
        HttpResponse.json(
          { error: { code: 'PROVIDER_CREDENTIAL_INVALID', message: 'Reconnect with a new token.' } },
          { status: 409, headers: { 'X-Request-Id': 'req-cred' } },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Sync now' }));
    expect(await screen.findByText('The stored GitHub token no longer works.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy();
  });

  it('keeps the state filter and page in the url', async () => {
    db.pulls = [pullRequest(), pullRequest({ id: '66666666-6666-4666-8666-666666666666', pr_number: 8, state: 'merged', title: 'Merged work' })];
    const user = userEvent.setup();
    renderAt(`/repositories/${REPO_ID}`);
    expect(await screen.findByText('Add audit trail')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Open' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Merged' }));
    expect(await screen.findByText('Merged work')).toBeTruthy();
    expect(screen.queryByText('Add audit trail')).toBeNull();
  });
});

describe('audits', () => {
  it('navigates on 202 and on an already active audit', async () => {
    const user = userEvent.setup();
    db.list = [];
    db.audit = { id: AUDIT_ID, pr_id: PR_ID, commit_sha: SHA, status: 'pending', created_at: new Date().toISOString() };
    renderAt(`/pull-requests/${PR_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Start audit' }));
    expect(await screen.findByText('Waiting in queue…')).toBeTruthy();
    cleanup();

    db.audit = { id: AUDIT_ID, pr_id: PR_ID, commit_sha: SHA, status: 'running', created_at: new Date().toISOString() };
    db.startStatus = 409;
    renderAt(`/pull-requests/${PR_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Start audit' }));
    expect(await screen.findByText('An audit for this commit is already running')).toBeTruthy();
  });

  it('distinguishes the active-audit limit from a generic rate limit', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`http://localhost:3000/api/pull-requests/${PR_ID}/audits`, () =>
        HttpResponse.json({ error: { code: 'TOO_MANY_ACTIVE_AUDITS', message: 'Too many.' } }, { status: 429, headers: { 'X-Request-Id': 'req-cap' } }),
      ),
    );
    renderAt(`/pull-requests/${PR_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Start audit' }));
    const limit = await screen.findByText(/you've reached your limit of active audits/i);
    expect(limit.textContent?.toLowerCase()).not.toContain('guarantee');
    cleanup();

    server.use(
      http.post(`http://localhost:3000/api/pull-requests/${PR_ID}/audits`, () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
          { status: 429, headers: { 'Retry-After': '30', 'X-Request-Id': 'req-rate' } },
        ),
      ),
    );
    renderAt(`/pull-requests/${PR_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Start audit' }));
    expect(await screen.findByText('Too many requests. Please try again later.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start audit' })).toHaveProperty('disabled', true);
  });

  it('renders a completed audit, an older commit, and a failed audit reference', async () => {
    db.list = [{ ...db.list[0]!, commit_sha: 'b'.repeat(40), flag_count: undefined }];
    renderAt(`/pull-requests/${PR_ID}`);
    expect(await screen.findByText('Audited an older commit')).toBeTruthy();

    db.audit = completedAudit();
    renderAt(`/audits/${AUDIT_ID}`);
    expect(await screen.findByText('A secret was added.')).toBeTruthy();
    expect(screen.getByText(/this audit analyzed/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /show omitted files/i }));
    expect(screen.getByText('package-lock.json')).toBeTruthy();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(titles[0]).toBe('Token in source');
    await userEvent.click(screen.getByRole('button', { name: /info/i }));
    expect(screen.queryByText('Token in source')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /all/i }));
    expect(screen.queryByText('No security findings')).toBeNull();
    cleanup();

    db.audit = completedAudit({ ai_security_flags: [], diff_truncated: false, diff_omitted_files: [] });
    renderAt(`/audits/${AUDIT_ID}`);
    expect(await screen.findByText('No security findings')).toBeTruthy();
    expect(screen.getByText(/not proof that the change is safe/i)).toBeTruthy();
  });

  it('shows the long-running notice after ten minutes of polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      db.audit = { id: AUDIT_ID, pr_id: PR_ID, commit_sha: SHA, status: 'pending', created_at: new Date().toISOString() };
      renderAt(`/audits/${AUDIT_ID}`);
      expect(await screen.findByText('Waiting in queue…')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(await screen.findByText(/taking longer than expected/i)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('failed audit copy', () => {
  const cases: Array<[string, string]> = [
    ['HEAD_SHA_CHANGED', 'The pull request was updated while the audit ran.'],
    ['DIFF_EMPTY', 'This pull request has no changes to analyze.'],
    ['DIFF_TOO_LARGE', 'This pull request is too large to analyze.'],
    ['PROVIDER_CREDENTIAL_INVALID', 'The stored GitHub token no longer works.'],
    ['PROVIDER_PERMISSION_DENIED', 'The GitHub token lacks the required permissions (Pull requests: Read, Contents: Read).'],
    ['PROVIDER_RESOURCE_NOT_FOUND', 'GitHub could not find that repository or pull request, or the token cannot see it.'],
    ['PROVIDER_RATE_LIMITED', 'GitHub is rate limiting requests. Try again shortly.'],
    ['PROVIDER_UNAVAILABLE', 'GitHub is unreachable right now.'],
    ['AI_REFUSED', 'The AI step failed.'],
    ['AI_OUTPUT_TRUNCATED', 'The AI step failed.'],
    ['AI_INVALID_OUTPUT', 'The AI step failed.'],
    ['AI_UNAVAILABLE', 'The AI step failed.'],
    ['AUDIT_PROCESSING_TIMEOUT', 'This audit took too long and was stopped.'],
    ['REPOSITORY_ACCESS_LOST', 'The repository is no longer accessible.'],
    ['AUDIT_ATTEMPTS_EXHAUSTED', 'The audit was interrupted repeatedly. Start a new one.'],
  ];

  it.each(cases)('explains %s', (code, text) => {
    expect(friendlyAuditFailure(code, 'backend detail')).toBe(text);
    render(
      <AuditFailure code={code} backendMessage="backend detail" requestId="req-fail" pending={false} onStart={() => undefined} onReconnect={() => undefined} />,
    );
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByText('Reference: req-fail')).toBeTruthy();
  });

  it('shows the backend message for an unknown code', () => {
    render(
      <AuditFailure code="INTERNAL_ERROR" backendMessage="The audit failed while saving results." requestId="req-unknown" pending={false} onStart={() => undefined} onReconnect={() => undefined} />,
    );
    expect(screen.getByText('The audit failed while saving results.')).toBeTruthy();
    expect(screen.getByText('Reference: req-unknown')).toBeTruthy();
  });
});
