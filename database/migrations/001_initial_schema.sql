BEGIN;

-- ============================================================
-- AI-NATIVE CODEBASE TECHNICAL WRITER & PR AUDITOR
-- INITIAL DATABASE SCHEMA (v3)
--
-- Run on a FRESH Supabase project (PostgreSQL 15+).
--
-- TRUST MODEL
--   Browser (role: authenticated)
--     SELECT  : users, repositories, pull_requests, audit_runs
--     UPDATE  : users.display_name only
--     NO ACCESS: repository_credentials, audit_run_diffs
--   Backend (role: service_role)
--     FULL ACCESS to everything, including the RPC functions below.
--   anon
--     NO ACCESS to anything.
--
-- NOTES
--   * repository_credentials.ciphertext holds AES-256-GCM ciphertext.
--     Encryption happens in the backend (AAD = repository id).
--   * Raw diffs (private source code) live in audit_run_diffs,
--     which the browser cannot read.
--   * Worker claim/recovery, the per-user active-audit cap, and the
--     fenced diff insert are atomic SQL functions callable only by
--     service_role (they are in the public schema so PostgREST RPC can
--     reach them; EXECUTE is revoked from everyone else).
--
-- v3 additions (still this single initial script; safe on a fresh project):
--   * create_pending_audit locks the user row, then inserts only while
--     that user is under p_max_active. Concurrent creates can no longer
--     both pass a count check.
--   * insert_audit_diff_if_owner locks the claimed audit row and inserts
--     the diff only for that worker and attempt. ON CONFLICT DO NOTHING
--     never overwrites a diff already stored for the audit.
--   * recover_stale_audits now records duration_ms on exhausted rows.
--   * audit_run_diffs.raw_diff cannot be blank.
--   * Supabase grants new public objects to anon/authenticated by
--     default, so every object below revokes explicitly.
-- ============================================================


-- ============================================================
-- 1. PRIVATE SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA private TO postgres, service_role, authenticated;


-- ============================================================
-- 2. ENUMS
-- ============================================================

CREATE TYPE public.git_provider AS ENUM (
    'github',
    'gitlab',
    'bitbucket'
);

CREATE TYPE public.provider_pr_state AS ENUM (
    'open',
    'draft',
    'closed',
    'merged'
);

CREATE TYPE public.audit_run_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed'
);

-- Highest severity among the AI findings, computed by the backend.
CREATE TYPE public.audit_risk_level AS ENUM (
    'none',
    'low',
    'medium',
    'high',
    'critical'
);

GRANT USAGE ON TYPE public.git_provider       TO authenticated, service_role;
GRANT USAGE ON TYPE public.provider_pr_state  TO authenticated, service_role;
GRANT USAGE ON TYPE public.audit_run_status   TO authenticated, service_role;
GRANT USAGE ON TYPE public.audit_risk_level   TO authenticated, service_role;


-- ============================================================
-- 3. HELPER FUNCTIONS (private)
-- ============================================================

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_updated_at()
    TO authenticated, postgres, service_role;


-- Picks a display name from Supabase Auth metadata, trims it, and
-- guarantees it satisfies users_display_name_valid so a long or blank
-- OAuth name can never make sign-up fail.
CREATE OR REPLACE FUNCTION private.pick_display_name(meta jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT NULLIF(
        left(
            COALESCE(
                NULLIF(btrim(meta ->> 'display_name'), ''),
                NULLIF(btrim(meta ->> 'full_name'), ''),
                NULLIF(btrim(meta ->> 'name'), '')
            ),
            100
        ),
        ''
    );
$$;

REVOKE ALL ON FUNCTION private.pick_display_name(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.pick_display_name(jsonb) TO postgres, service_role;


-- ============================================================
-- 4. USERS
-- ============================================================

CREATE TABLE public.users (

    id UUID PRIMARY KEY
        REFERENCES auth.users(id)
        ON DELETE CASCADE,

    email TEXT,

    display_name TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT users_display_name_valid
        CHECK (
            display_name IS NULL
            OR (
                btrim(display_name) <> ''
                AND char_length(display_name) <= 100
            )
        )
);

CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_select_own
ON public.users
FOR SELECT
TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY users_update_own
ON public.users
FOR UPDATE
TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));


-- ============================================================
-- 5. REPOSITORIES
--
-- Backend normalization rules (also documented in the build prompt):
--   owner / repo_name : stored exactly as the provider returns them.
--   repo_url          : canonical HTML URL from the provider,
--                       no trailing slash, no ".git".
-- Uniqueness is case-insensitive because GitHub names are.
-- ============================================================

CREATE TABLE public.repositories (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES public.users(id)
        ON DELETE CASCADE,

    provider public.git_provider NOT NULL DEFAULT 'github',

    provider_repository_id TEXT NOT NULL,

    owner TEXT NOT NULL,

    repo_name TEXT NOT NULL,

    repo_url TEXT NOT NULL,

    default_branch TEXT NOT NULL DEFAULT 'main',

    is_private BOOLEAN NOT NULL DEFAULT false,

    last_synced_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT repositories_provider_repository_id_not_blank
        CHECK (btrim(provider_repository_id) <> ''),

    CONSTRAINT repositories_owner_not_blank
        CHECK (btrim(owner) <> ''),

    CONSTRAINT repositories_repo_name_not_blank
        CHECK (btrim(repo_name) <> ''),

    CONSTRAINT repositories_repo_url_not_blank
        CHECK (btrim(repo_url) <> ''),

    CONSTRAINT repositories_default_branch_not_blank
        CHECK (btrim(default_branch) <> '')
);

CREATE UNIQUE INDEX repositories_user_url_unique
ON public.repositories (user_id, lower(repo_url));

CREATE UNIQUE INDEX repositories_provider_id_unique
ON public.repositories (user_id, provider, provider_repository_id);

CREATE UNIQUE INDEX repositories_owner_name_unique
ON public.repositories (user_id, provider, lower(owner), lower(repo_name));

CREATE TRIGGER repositories_set_updated_at
BEFORE UPDATE ON public.repositories
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repositories FORCE ROW LEVEL SECURITY;

CREATE POLICY repositories_select_own
ON public.repositories
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));

-- No authenticated INSERT / UPDATE / DELETE. Writes go through the backend.


-- ============================================================
-- 6. REPOSITORY CREDENTIALS (backend only)
-- ============================================================

CREATE TABLE public.repository_credentials (

    repo_id UUID PRIMARY KEY
        REFERENCES public.repositories(id)
        ON DELETE CASCADE,

    ciphertext TEXT NOT NULL,

    encryption_key_id TEXT NOT NULL DEFAULT 'app-v1',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT repository_credentials_ciphertext_not_blank
        CHECK (btrim(ciphertext) <> ''),

    CONSTRAINT repository_credentials_key_id_not_blank
        CHECK (btrim(encryption_key_id) <> '')
);

CREATE TRIGGER repository_credentials_set_updated_at
BEFORE UPDATE ON public.repository_credentials
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.repository_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repository_credentials FORCE ROW LEVEL SECURITY;

-- NO policies and NO grants for authenticated / anon.


-- ============================================================
-- 7. PULL REQUESTS
--
-- GitHub state mapping (done in the backend):
--   state = open   AND draft = true        -> draft
--   state = open   AND draft = false       -> open
--   state = closed AND merged_at IS NULL   -> closed
--   state = closed AND merged_at NOT NULL  -> merged
--
-- additions / deletions / changed_files are NOT returned by GitHub's
-- list endpoint, so they stay NULL until the PR is fetched
-- individually (done when an audit is requested).
-- ============================================================

CREATE TABLE public.pull_requests (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    repo_id UUID NOT NULL
        REFERENCES public.repositories(id)
        ON DELETE CASCADE,

    pr_number INTEGER NOT NULL,

    provider_pr_id TEXT NOT NULL,

    title TEXT NOT NULL DEFAULT '',

    author_login TEXT,

    html_url TEXT,

    base_branch TEXT NOT NULL DEFAULT 'main',

    head_branch TEXT,

    head_sha TEXT NOT NULL,

    state public.provider_pr_state NOT NULL DEFAULT 'open',

    additions INTEGER,

    deletions INTEGER,

    changed_files INTEGER,

    provider_created_at TIMESTAMPTZ,

    provider_updated_at TIMESTAMPTZ,

    closed_at TIMESTAMPTZ,

    merged_at TIMESTAMPTZ,

    last_synced_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pull_requests_pr_number_positive
        CHECK (pr_number > 0),

    CONSTRAINT pull_requests_provider_pr_id_not_blank
        CHECK (btrim(provider_pr_id) <> ''),

    CONSTRAINT pull_requests_base_branch_not_blank
        CHECK (btrim(base_branch) <> ''),

    CONSTRAINT pull_requests_head_branch_not_blank
        CHECK (head_branch IS NULL OR btrim(head_branch) <> ''),

    -- Lowercase hex only: the backend lowercases before writing so that
    -- the in-flight unique index on audit_runs cannot be bypassed by case.
    CONSTRAINT pull_requests_head_sha_valid
        CHECK (
            head_sha ~ '^[0-9a-f]{40}$'
            OR head_sha ~ '^[0-9a-f]{64}$'
        ),

    CONSTRAINT pull_requests_counts_nonnegative
        CHECK (
            (additions     IS NULL OR additions     >= 0)
            AND (deletions     IS NULL OR deletions     >= 0)
            AND (changed_files IS NULL OR changed_files >= 0)
        ),

    CONSTRAINT pull_requests_merged_consistent
        CHECK ((state = 'merged') = (merged_at IS NOT NULL)),

    CONSTRAINT pull_requests_closed_consistent
        CHECK (
            (state IN ('open', 'draft')   AND closed_at IS NULL)
            OR
            (state IN ('closed', 'merged') AND closed_at IS NOT NULL)
        )
);

-- Non-partial, so the backend can use ON CONFLICT (repo_id, pr_number).
CREATE UNIQUE INDEX pull_requests_repo_number_unique
ON public.pull_requests (repo_id, pr_number);

CREATE UNIQUE INDEX pull_requests_provider_id_unique
ON public.pull_requests (repo_id, provider_pr_id);

-- Serves: WHERE repo_id = ? [AND state = ?] ORDER BY pr_number DESC
CREATE INDEX pull_requests_repo_state_number_idx
ON public.pull_requests (repo_id, state, pr_number DESC);

CREATE INDEX pull_requests_repo_number_desc_idx
ON public.pull_requests (repo_id, pr_number DESC);

CREATE TRIGGER pull_requests_set_updated_at
BEFORE UPDATE ON public.pull_requests
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.pull_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pull_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY pull_requests_select_own
ON public.pull_requests
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.repositories AS r
        WHERE r.id = pull_requests.repo_id
          AND r.user_id = (SELECT auth.uid())
    )
);

-- No authenticated INSERT / UPDATE / DELETE. Backend synchronizes PR data.


-- ============================================================
-- 8. AUDIT RUNS
--
-- Lifecycle:
--   pending  -> running   (claim_next_audit)
--   running  -> completed | failed        (worker)
--   running  -> pending   (recover_stale_audits, attempts < max_attempts)
--   running  -> failed    (recover_stale_audits, attempts exhausted)
--
-- `attempts` counts CLAIMS, so it only grows when a worker picked the
-- audit up. It is the poison-audit brake for crash loops, and also the
-- fencing token: a worker may only finish an audit, or store its diff,
-- if (id, status='running', worker_id, attempts) still match its claim.
-- Pending rows are created only through create_pending_audit.
--
-- duration_ms is the wall-clock time of the final (successful or
-- failing) attempt, not the whole time since creation.
-- ============================================================

CREATE TABLE public.audit_runs (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    pr_id UUID NOT NULL
        REFERENCES public.pull_requests(id)
        ON DELETE CASCADE,

    commit_sha TEXT NOT NULL,

    status public.audit_run_status NOT NULL DEFAULT 'pending',

    -- Results (browser-readable)
    risk_level public.audit_risk_level,

    summary TEXT NOT NULL DEFAULT '',

    generated_documentation TEXT NOT NULL DEFAULT '',

    ai_security_flags JSONB NOT NULL DEFAULT '[]'::jsonb,

    model TEXT,

    prompt_version TEXT,

    token_usage JSONB NOT NULL
        DEFAULT '{"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}'::jsonb,

    -- Failure information (safe, sanitized by the backend)
    error_code TEXT,

    error_message TEXT,

    -- Diff coverage. The full diff lives in audit_run_diffs.
    diff_bytes INTEGER,

    analyzed_diff_bytes INTEGER,

    files_changed INTEGER,

    diff_truncated BOOLEAN NOT NULL DEFAULT false,

    -- [{ "path": "...", "reason": "size_budget|no_patch|binary|fetch_cap" }]
    diff_omitted_files JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Worker bookkeeping
    attempts INTEGER NOT NULL DEFAULT 0,

    max_attempts INTEGER NOT NULL DEFAULT 3,

    worker_id TEXT,

    started_at TIMESTAMPTZ,

    heartbeat_at TIMESTAMPTZ,

    duration_ms BIGINT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    completed_at TIMESTAMPTZ,

    -- Identity / format
    CONSTRAINT audit_runs_commit_sha_valid
        CHECK (
            commit_sha ~ '^[0-9a-f]{40}$'
            OR commit_sha ~ '^[0-9a-f]{64}$'
        ),

    CONSTRAINT audit_runs_flags_array
        CHECK (jsonb_typeof(ai_security_flags) = 'array'),

    CONSTRAINT audit_runs_token_usage_object
        CHECK (jsonb_typeof(token_usage) = 'object'),

    CONSTRAINT audit_runs_omitted_files_array
        CHECK (jsonb_typeof(diff_omitted_files) = 'array'),

    CONSTRAINT audit_runs_error_message_not_blank
        CHECK (error_message IS NULL OR btrim(error_message) <> ''),

    CONSTRAINT audit_runs_error_code_not_blank
        CHECK (error_code IS NULL OR btrim(error_code) <> ''),

    -- Numbers
    CONSTRAINT audit_runs_duration_nonnegative
        CHECK (duration_ms IS NULL OR duration_ms >= 0),

    CONSTRAINT audit_runs_attempts_valid
        CHECK (
            attempts >= 0
            AND max_attempts >= 1
            AND attempts <= max_attempts
        ),

    CONSTRAINT audit_runs_diff_numbers_valid
        CHECK (
            (diff_bytes          IS NULL OR diff_bytes          >= 0)
            AND (analyzed_diff_bytes IS NULL OR analyzed_diff_bytes >= 0)
            AND (files_changed       IS NULL OR files_changed       >= 0)
            AND (
                analyzed_diff_bytes IS NULL
                OR diff_bytes IS NULL
                OR analyzed_diff_bytes <= diff_bytes
            )
        ),

    -- Never claim full coverage when coverage was partial.
    CONSTRAINT audit_runs_truncation_recorded
        CHECK (
            (
                NOT diff_truncated
                OR (diff_bytes IS NOT NULL AND analyzed_diff_bytes IS NOT NULL)
            )
            AND (
                analyzed_diff_bytes IS NULL
                OR diff_bytes IS NULL
                OR analyzed_diff_bytes = diff_bytes
                OR diff_truncated
            )
            AND (
                jsonb_array_length(diff_omitted_files) = 0
                OR diff_truncated
            )
        ),

    -- Status <-> timestamps / worker fields
    CONSTRAINT audit_runs_lifecycle_consistent
        CHECK (
            (
                status = 'pending'
                AND started_at IS NULL
                AND heartbeat_at IS NULL
                AND worker_id IS NULL
                AND completed_at IS NULL
            )
            OR
            (
                status = 'running'
                AND started_at IS NOT NULL
                AND heartbeat_at IS NOT NULL
                AND worker_id IS NOT NULL
                AND completed_at IS NULL
            )
            OR
            (
                status IN ('completed', 'failed')
                AND completed_at IS NOT NULL
            )
        ),

    CONSTRAINT audit_runs_failed_has_error
        CHECK (
            status <> 'failed'
            OR (error_message IS NOT NULL AND error_code IS NOT NULL)
        ),

    -- A completed audit must be fully populated and must not carry an error.
    CONSTRAINT audit_runs_completed_is_complete
        CHECK (
            status <> 'completed'
            OR (
                error_message IS NULL
                AND error_code IS NULL
                AND btrim(generated_documentation) <> ''
                AND risk_level IS NOT NULL
                AND model IS NOT NULL
                AND prompt_version IS NOT NULL
                AND duration_ms IS NOT NULL
                AND diff_bytes IS NOT NULL
                AND analyzed_diff_bytes IS NOT NULL
            )
        )
);

-- Same PR + commit history lookups.
CREATE INDEX audit_runs_pr_commit_idx
ON public.audit_runs (pr_id, commit_sha);

-- Audit history, newest first, stable pagination.
CREATE INDEX audit_runs_pr_history_idx
ON public.audit_runs (pr_id, created_at DESC, id DESC);

-- Worker queue: oldest pending first.
CREATE INDEX audit_runs_pending_queue_idx
ON public.audit_runs (created_at)
WHERE status = 'pending';

-- Stale-run recovery scan.
CREATE INDEX audit_runs_running_heartbeat_idx
ON public.audit_runs (heartbeat_at)
WHERE status = 'running';

-- One active audit per PR + commit. Completed/failed rows are history.
CREATE UNIQUE INDEX audit_runs_one_inflight_per_commit
ON public.audit_runs (pr_id, commit_sha)
WHERE status IN ('pending', 'running');

CREATE TRIGGER audit_runs_set_updated_at
BEFORE UPDATE ON public.audit_runs
FOR EACH ROW
EXECUTE FUNCTION private.set_updated_at();

ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_runs_select_own
ON public.audit_runs
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1
        FROM public.pull_requests AS pr
        INNER JOIN public.repositories AS r
            ON r.id = pr.repo_id
        WHERE pr.id = audit_runs.pr_id
          AND r.user_id = (SELECT auth.uid())
    )
);

-- No authenticated INSERT / UPDATE / DELETE. Backend owns the audit lifecycle.


-- ============================================================
-- 9. AUDIT RUN DIFFS (backend only)
--
-- Holds the raw diff (private source code). Kept out of audit_runs so
-- the browser can never SELECT it and list queries stay light.
-- ============================================================

CREATE TABLE public.audit_run_diffs (

    audit_id UUID PRIMARY KEY
        REFERENCES public.audit_runs(id)
        ON DELETE CASCADE,

    raw_diff TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT audit_run_diffs_raw_diff_not_blank
        CHECK (btrim(raw_diff) <> '')
);

ALTER TABLE public.audit_run_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_run_diffs FORCE ROW LEVEL SECURITY;

-- NO policies and NO grants for authenticated / anon.


-- ============================================================
-- 10. TABLE PRIVILEGES
-- ============================================================

REVOKE ALL ON public.users                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.repositories           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.repository_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.pull_requests          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_runs             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_run_diffs        FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.users                  TO postgres, service_role;
GRANT ALL ON public.repositories           TO postgres, service_role;
GRANT ALL ON public.repository_credentials TO postgres, service_role;
GRANT ALL ON public.pull_requests          TO postgres, service_role;
GRANT ALL ON public.audit_runs             TO postgres, service_role;
GRANT ALL ON public.audit_run_diffs        TO postgres, service_role;

-- Browser: read-only on four tables, plus display_name update.
GRANT SELECT ON public.users         TO authenticated;
GRANT SELECT ON public.repositories  TO authenticated;
GRANT SELECT ON public.pull_requests TO authenticated;
GRANT SELECT ON public.audit_runs    TO authenticated;

-- updated_at is set by the trigger; it needs no column privilege.
GRANT UPDATE (display_name) ON public.users TO authenticated;


-- ============================================================
-- 11. BACKEND RPC FUNCTIONS (service_role only)
-- ============================================================

-- 11.1 Atomically create a repository and its encrypted credential.
--      The backend generates p_id first so it can bind the ciphertext
--      to it (AES-GCM AAD). A duplicate raises 23505.
CREATE OR REPLACE FUNCTION public.create_repository_with_credential(
    p_id                     uuid,
    p_user_id                uuid,
    p_provider               public.git_provider,
    p_provider_repository_id text,
    p_owner                  text,
    p_repo_name              text,
    p_repo_url               text,
    p_default_branch         text,
    p_is_private             boolean,
    p_ciphertext             text,
    p_encryption_key_id      text
)
RETURNS public.repositories
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_repo public.repositories;
BEGIN
    INSERT INTO public.repositories (
        id, user_id, provider, provider_repository_id,
        owner, repo_name, repo_url, default_branch, is_private
    )
    VALUES (
        p_id, p_user_id, p_provider, p_provider_repository_id,
        p_owner, p_repo_name, p_repo_url, p_default_branch, p_is_private
    )
    RETURNING * INTO v_repo;

    INSERT INTO public.repository_credentials (
        repo_id, ciphertext, encryption_key_id
    )
    VALUES (
        v_repo.id, p_ciphertext, p_encryption_key_id
    );

    RETURN v_repo;
END;
$$;


-- 11.2 Atomically claim the oldest pending audit.
--      FOR UPDATE SKIP LOCKED makes concurrent workers safe.
--      Returns zero rows when there is nothing to claim.
CREATE OR REPLACE FUNCTION public.claim_next_audit(p_worker_id text)
RETURNS SETOF public.audit_runs
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    UPDATE public.audit_runs AS a
    SET status       = 'running',
        started_at   = now(),
        heartbeat_at = now(),
        worker_id    = p_worker_id,
        attempts     = a.attempts + 1
    WHERE a.id = (
        SELECT c.id
        FROM public.audit_runs AS c
        WHERE c.status = 'pending'
          AND c.attempts < c.max_attempts
        ORDER BY c.created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING a.*;
$$;


-- 11.3 Recover audits whose worker died.
--      running + stale heartbeat + attempts left  -> pending
--      running + stale heartbeat + no attempts    -> failed
CREATE OR REPLACE FUNCTION public.recover_stale_audits(p_stale_after_seconds integer)
RETURNS TABLE (requeued integer, exhausted integer)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
    WITH stale AS (
        SELECT id, attempts, max_attempts
        FROM public.audit_runs
        WHERE status = 'running'
          AND heartbeat_at < now() - make_interval(secs => p_stale_after_seconds)
        FOR UPDATE SKIP LOCKED
    ),
    requeued AS (
        UPDATE public.audit_runs AS a
        SET status       = 'pending',
            started_at   = NULL,
            heartbeat_at = NULL,
            worker_id    = NULL
        FROM stale AS s
        WHERE a.id = s.id
          AND s.attempts < s.max_attempts
        RETURNING a.id
    ),
    exhausted AS (
        UPDATE public.audit_runs AS a
        SET status        = 'failed',
            error_code    = 'AUDIT_ATTEMPTS_EXHAUSTED',
            error_message = 'The audit was interrupted repeatedly and was stopped. Please start a new audit.',
            completed_at  = now(),
            duration_ms   = COALESCE(
                GREATEST(
                    0,
                    floor(extract(epoch FROM (now() - a.started_at)) * 1000)::bigint
                ),
                0
            )
        FROM stale AS s
        WHERE a.id = s.id
          AND s.attempts >= s.max_attempts
        RETURNING a.id
    )
    SELECT
        (SELECT count(*) FROM requeued)::integer,
        (SELECT count(*) FROM exhausted)::integer;
$$;


-- 11.4 Insert one pending audit while the user is under the active cap.
--      The user row lock serializes concurrent creates for that user, so
--      the count and the insert cannot both succeed past p_max_active.
--      A second in-flight row for the same pull request and commit still
--      raises 23505. P0001 / TOO_MANY_ACTIVE_AUDITS means the cap blocked
--      the insert. P0002 / RESOURCE_NOT_FOUND means the user does not own
--      the pull request (or the user row is gone).
CREATE OR REPLACE FUNCTION public.create_pending_audit(
    p_user_id      uuid,
    p_pr_id        uuid,
    p_commit_sha   text,
    p_max_attempts integer,
    p_max_active   integer
)
RETURNS TABLE (
    id         uuid,
    pr_id      uuid,
    commit_sha text,
    status     public.audit_run_status
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_active integer;
    v_row public.audit_runs;
BEGIN
    IF p_max_attempts < 1 OR p_max_active < 0 THEN
        RAISE EXCEPTION 'INVALID_AUDIT_LIMITS' USING ERRCODE = '22023';
    END IF;

    PERFORM 1
    FROM public.users
    WHERE users.id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    PERFORM 1
    FROM public.pull_requests AS pr
    INNER JOIN public.repositories AS r
        ON r.id = pr.repo_id
    WHERE pr.id = p_pr_id
      AND r.user_id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RESOURCE_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;

    SELECT count(*)::integer
    INTO v_active
    FROM public.audit_runs AS a
    INNER JOIN public.pull_requests AS pr
        ON pr.id = a.pr_id
    INNER JOIN public.repositories AS r
        ON r.id = pr.repo_id
    WHERE r.user_id = p_user_id
      AND a.status IN ('pending', 'running');

    IF v_active >= p_max_active THEN
        RAISE EXCEPTION 'TOO_MANY_ACTIVE_AUDITS' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.audit_runs (pr_id, commit_sha, status, max_attempts)
    VALUES (p_pr_id, p_commit_sha, 'pending', p_max_attempts)
    RETURNING * INTO v_row;

    RETURN QUERY
    SELECT v_row.id, v_row.pr_id, v_row.commit_sha, v_row.status;
END;
$$;


-- 11.5 Store a raw diff only for the worker that currently owns the claim.
--      Locks the audit row, checks the fence, then inserts. A conflict
--      keeps the diff already stored. Returns false when this worker no
--      longer owns the audit, including when the audit was deleted.
--      Returns true when the fence held, whether or not a new row was written.
CREATE OR REPLACE FUNCTION public.insert_audit_diff_if_owner(
    p_audit_id  uuid,
    p_worker_id text,
    p_attempts  integer,
    p_raw_diff  text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    PERFORM 1
    FROM public.audit_runs
    WHERE audit_runs.id = p_audit_id
      AND audit_runs.status = 'running'
      AND audit_runs.worker_id = p_worker_id
      AND audit_runs.attempts = p_attempts
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    INSERT INTO public.audit_run_diffs (audit_id, raw_diff)
    VALUES (p_audit_id, p_raw_diff)
    ON CONFLICT (audit_id) DO NOTHING;

    RETURN true;
END;
$$;


REVOKE ALL ON FUNCTION public.create_repository_with_credential(
    uuid, uuid, public.git_provider, text, text, text, text, text, boolean, text, text
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_next_audit(text)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.recover_stale_audits(integer)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.create_pending_audit(uuid, uuid, text, integer, integer)
    FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.insert_audit_diff_if_owner(uuid, text, integer, text)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_repository_with_credential(
    uuid, uuid, public.git_provider, text, text, text, text, text, boolean, text, text
) TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.claim_next_audit(text)
    TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.recover_stale_audits(integer)
    TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.create_pending_audit(uuid, uuid, text, integer, integer)
    TO postgres, service_role;

GRANT EXECUTE ON FUNCTION public.insert_audit_diff_if_owner(uuid, text, integer, text)
    TO postgres, service_role;


-- ============================================================
-- 12. AUTH -> PUBLIC.USERS SYNC
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.users (id, email, display_name)
    VALUES (
        NEW.id,
        NEW.email,
        private.pick_display_name(NEW.raw_user_meta_data)
    )
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_created()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_auth_user_created()
    TO postgres, supabase_auth_admin;


CREATE OR REPLACE FUNCTION public.handle_auth_user_email_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.users
    SET email = NEW.email
    WHERE id = NEW.id;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_auth_user_email_sync()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_auth_user_email_sync()
    TO postgres, supabase_auth_admin;


CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_auth_user_created();

CREATE TRIGGER on_auth_user_email_changed
AFTER UPDATE OF email ON auth.users
FOR EACH ROW
WHEN (OLD.email IS DISTINCT FROM NEW.email)
EXECUTE FUNCTION public.handle_auth_user_email_sync();


-- ============================================================
-- 13. BACKFILL EXISTING AUTH USERS
-- ============================================================

INSERT INTO public.users (id, email, display_name)
SELECT
    id,
    email,
    private.pick_display_name(raw_user_meta_data)
FROM auth.users
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email;


COMMIT;

-- ============================================================
-- POST-MIGRATION SMOKE TESTS (run manually)
--   1. Create a test user through Supabase Auth and confirm a row
--      appears in public.users (proves the auth trigger works with
--      FORCE ROW LEVEL SECURITY).
--   2. As the anon and authenticated roles, confirm SELECT on
--      repository_credentials and audit_run_diffs is denied.
--   3. Call public.claim_next_audit('test') as service_role on an
--      empty queue and confirm it returns zero rows.
--   4. As anon and authenticated, confirm EXECUTE is denied on
--      create_pending_audit and insert_audit_diff_if_owner.
-- ============================================================