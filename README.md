# AI-Native Codebase Technical Writer & PR Auditor

A local portfolio app that connects a GitHub repository, syncs its pull requests, and runs an AI audit of one pull request at one commit. Each audit stores generated technical documentation, security findings, and a risk level.

This is a single-user demo, not a multi-tenant production service.

## What it does

1. Sign up and sign in with email and password (Supabase Auth).
2. Connect a repository with a fine-grained, read-only GitHub personal access token.
3. Sync pull requests from GitHub.
4. Start an audit. A background worker fetches the diff, sends the selected changes to OpenAI, and saves the result.
5. Read the documentation, findings, and risk level in the web UI.

## Layout

| Path | Role |
| --- | --- |
| `frontend/` | React UI (Vite, TypeScript) |
| `backend/` | Express API and in-process audit worker |
| `database/migrations/` | Postgres schema, including row-level security |

Setup, environment variables, and API details live in [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

## Requirements

- Node.js 20 or newer
- A Supabase project
- An OpenAI API key and a model that supports strict structured outputs
- A GitHub personal access token with read access to pull requests and contents

## Run it locally

Apply `database/migrations/001_initial_schema.sql` in the Supabase SQL editor, then start the API and the UI.

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

```bash
cd frontend
npm install
copy .env.example .env
npm run dev
```

The API listens on `http://localhost:3000`. The UI listens on `http://localhost:5173`. On macOS or Linux, use `cp .env.example .env` instead of `copy`.

Copy `.env.example` in each app and fill in your own values. Do not commit `.env`. The frontend only needs public Supabase settings and the API URL. Secret keys, the OpenAI key, and the credential encryption key belong in the backend only.

## Tests

```bash
cd backend && npm test
cd frontend && npm test
```

Tests use fakes. They do not call live GitHub, OpenAI, or Supabase.
