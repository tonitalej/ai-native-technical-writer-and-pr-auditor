# PR Auditor frontend

Web UI for AI-Native Codebase Technical Writer & PR Auditor. A signed-in user connects a GitHub repository with a personal access token, syncs pull requests, starts an audit, and reads the generated documentation and security findings.

The backend at `http://localhost:3000` is the API contract. This app does not query Supabase tables. Supabase is used only for email and password authentication.

## Stack

React 18, TypeScript, Vite, React Router, TanStack Query, Zod, and `react-markdown`. Styling is plain CSS with light and dark tokens from `prefers-color-scheme`.

`@vitejs/plugin-react` compiles JSX. `jsdom` is the test DOM. Both are dev dependencies required by the chosen toolchain.

## Prerequisites

- Node.js 20+
- The backend running at `http://localhost:3000`
- A Supabase project with the backend migration applied
- Backend `CORS_ORIGIN` including `http://localhost:5173`

## Setup

```bash
cd frontend
copy .env.example .env
npm install
npm run dev
```

On macOS or Linux, `cp .env.example .env` does the same copy. The dev server is `http://localhost:5173`.

Fill in:

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key (`sb_publishable_...`), the successor to the anon key |
| `VITE_SUPABASE_ANON_KEY` | Legacy name for that same browser key. Used only when the publishable key is unset. The app logs one console warning. |
| `VITE_API_URL` | Backend origin, `http://localhost:3000` locally |

Never put a secret key, service-role key, OpenAI key, or encryption key in this app. If a required value is missing, the UI shows a configuration page instead of a blank screen.

## How it talks to the backend

1. Supabase Auth issues an access token (`signUp`, `signInWithPassword`, `getSession`, `refreshSession`, `onAuthStateChange`, `signOut`).
2. Every `/api/*` call sends `Authorization: Bearer <access_token>`.
3. Success responses are `{ data }`. Lists also include `pagination`. Errors are `{ error: { code, message, details? } }`.
4. `apiFetch` reads `X-Request-Id` on every response. Failures keep it on `ApiError`. A failed audit shows `Reference: <id>` from the GET that loaded it.
5. A `401` refreshes the session once and retries once. If that still fails, the app signs out and clears the React Query cache. Provider `409` and `422` responses do not sign the user out.
6. Queries retry only network errors and HTTP 5xx, at most twice. Mutations do not retry.

## Polling

Audit detail polls every 2 seconds while `pending` or `running`, then every 5 seconds after 30 seconds of polling. It stops on `completed` or `failed`, on 401 or 404, and after 10 minutes. The 10-minute state tells the user the audit continues in the background and offers Refresh. The history list polls every 5 seconds only while some row is still `pending` or `running`. Polling pauses while the tab is hidden and refetches when the window is focused. There is no Supabase Realtime client.

## Security rules

- The GitHub token is a password field with `autoComplete="off"`. It lives in component state, is sent once, and is cleared when the request settles. It is not written to storage, the URL, or query keys. The connect mutation is reset so the token does not stay in the mutation cache.
- API strings render as text. AI documentation uses `react-markdown` with raw HTML skipped, images removed, and links limited to `http:` and `https:` with `rel="noopener noreferrer"`.
- Repository and pull request links render only when the URL is `https:`.

## Scripts

`npm run dev`, `build`, `preview`, `test`, `test:watch`, `lint`, `typecheck`, `format`.

## Deployment

This is a static Vite build. Host it on any static host. Set the backend `CORS_ORIGIN` to that origin. Add the origin in Supabase Authentication → URL Configuration.

A suitable Content-Security-Policy:

```text
default-src 'self'; connect-src 'self' https://api.example.com https://project.supabase.co; img-src 'self' data:; frame-ancestors 'none'
```

Replace the API and Supabase origins with the real ones.

## Backend contract notes

Checked against `backend/src/utils/present.ts` and the route controllers.

- Repository JSON includes `user_id` and `provider_repository_id`. The UI accepts them and does not display them.
- Pull request JSON includes `provider_pr_id`, `created_at`, and `updated_at`.
- User `email` may be null.
- Audit detail depends on status. `pending` and `running` return `id`, `pr_id`, `commit_sha`, `status`, and `created_at`. `failed` adds `error_code`, `error_message`, `duration_ms`, and `completed_at`. `completed` returns the result fields and does not include the error fields. The UI schema is a union on `status`, not one object with every field required.
- Audit list items include `flag_count`. Rendering still tolerates it being absent.
- `VALIDATION_ERROR` details are `{ fields: string[] }` (paths), not per-field messages.
- `duration_ms` may arrive as a number or a decimal string because it is a Postgres bigint. The schema accepts both.
- The active-audit cap is enforced in the database by `create_pending_audit`, which locks the user row. The UI still says "You've reached your limit of active audits" and does not claim the limit is impossible to pass.
- Timestamps are parsed as non-empty strings, not a strict ISO brand, so Supabase offsets still validate.

## Known V1 limitations

- Status updates are polled. There are no live updates.
- There is no password reset and no social login.
- The active-audit message does not describe the cap as a hard guarantee, even though the current backend serializes creates.
- A failed audit shows its request id for support. This app cannot look up server logs or explain more than the `error_message`.

## Minor assumptions

- Repository list pagination is stored in `?page=`, same as the pull request list. Audit history uses `?auditPage=`.
- Delete confirmation requires `owner/repo_name`.
- A `200` connect stays on the list and toasts. A `201` opens the repository.
- `RATE_LIMITED` disables the start button until `Retry-After` elapses. `TOO_MANY_ACTIVE_AUDITS` shows the limit message and leaves the button usable after the request, because that response does not send `Retry-After`.
- The 10-minute polling cutoff applies to the audit detail page. The history list stops when no row is in progress.
- Reconnect from a failed audit opens the connect dialog from the pull request page with the repository prefilled.
- Relative times use `Intl.RelativeTimeFormat` with the narrow style.
