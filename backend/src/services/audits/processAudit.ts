import type { AppConfig } from '../../config/env.js';
import type { AuditData, CredentialData } from '../../data/contracts.js';
import type { AuditFence, ClaimedAudit } from '../../types/audit.js';
import { EMPTY_TOKEN_USAGE } from '../../types/domain.js';
import {
  FenceLostError,
  ForeignKeyViolationError,
  ProcessingTimeoutError,
  isForeignKeyViolation,
} from '../../utils/errors.js';
import type { AppLogger } from '../../utils/logger.js';
import { sanitizeErrorMessage } from '../../utils/redact.js';
import { normalizeSha } from '../../utils/sha.js';
import { completeAuditAnalysis, type AiClient } from '../ai/aiService.js';
import { partialAnalysisNotice, capOmittedFiles } from './coverageNotice.js';
import { AUDIT_PROMPT_VERSION, buildAuditMessages } from '../ai/prompts/auditPrompt.js';
import {
  deriveRiskLevel,
  dropUnknownFileFlags,
  redactFlag,
  redactOutputText,
} from '../ai/postProcess.js';
import { redact } from '../../utils/redact.js';
import type { EncryptionService } from '../encryption/encryptionService.js';
import type { ProviderFactory } from '../providers/providerFactory.js';
import { auditErrorCodeFrom, auditFailure, AUDIT_ERROR_MESSAGES, type AuditErrorCode } from './auditErrors.js';
import { selectAnalyzableDiff } from './diffSelection.js';

export interface ProcessAuditDeps {
  config: AppConfig;
  audits: AuditData;
  credentials: CredentialData;
  providers: ProviderFactory;
  ai: AiClient;
  encryption: EncryptionService;
  logger: AppLogger;
}

export async function processClaimedAudit(deps: ProcessAuditDeps, claimed: ClaimedAudit): Promise<void> {
  const started = process.hrtime.bigint();
  const fence: AuditFence = {
    id: claimed.id,
    workerId: claimed.worker_id,
    attempts: claimed.attempts,
  };
  const log = deps.logger.child({ audit_id: claimed.id, worker_id: claimed.worker_id });
  const abort = new AbortController();
  const timeout = setTimeout(() => {
    abort.abort(new ProcessingTimeoutError());
  }, deps.config.auditMaxProcessingMs);

  const heartbeat = setInterval(() => {
    void deps.audits
      .fencedUpdate(fence, { heartbeat_at: new Date().toISOString() })
      .then((ok) => {
        if (!ok && !abort.signal.aborted) {
          abort.abort(new FenceLostError());
        }
      })
      .catch((error: unknown) => {
        log.warn({ err: error instanceof Error ? error.name : 'error' }, 'audit heartbeat failed');
      });
  }, deps.config.auditHeartbeatIntervalMs);

  const durationMs = (): number => {
    const elapsed = Number((process.hrtime.bigint() - started) / 1_000_000n);
    return elapsed >= 0 ? elapsed : 0;
  };

  try {
    const context = await deps.audits.getProcessingContext(claimed.id);
    if (!context) {
      log.warn('audit disappeared before processing');
      return;
    }
    if (!fenceHolds(context.audit, fence)) {
      log.warn('audit claim was no longer current');
      return;
    }

    const credential = await deps.credentials.getForOwnedRepository(
      context.repository.user_id,
      context.repository.id,
    );
    if (!credential) {
      throw auditFailure('REPOSITORY_ACCESS_LOST', 409);
    }
    const token = deps.encryption.decrypt(credential.ciphertext, credential.encryption_key_id, {
      repoId: context.repository.id,
    });
    const provider = deps.providers.getProvider(context.repository.provider);
    const coordinates = { owner: context.repository.owner, name: context.repository.repo_name };

    const before = await provider.getPullRequest(
      { token },
      coordinates,
      context.pullRequest.pr_number,
      abort.signal,
    );
    if (normalizeSha(before.headSha) !== claimed.commit_sha) {
      throw auditFailure('HEAD_SHA_CHANGED', 409);
    }

    const fetched = await provider.getPullRequestDiff(
      { token },
      coordinates,
      context.pullRequest.pr_number,
      claimed.commit_sha,
      abort.signal,
    );

    const after = await provider.getPullRequest(
      { token },
      coordinates,
      context.pullRequest.pr_number,
      abort.signal,
    );
    if (normalizeSha(after.headSha) !== claimed.commit_sha) {
      throw auditFailure('HEAD_SHA_CHANGED', 409);
    }
    throwIfAborted(abort.signal);

    const diffStored = await deps.audits.insertOwnedDiff(fence, fetched.diff);
    if (!diffStored) {
      log.warn('audit diff was not stored because the claim was lost');
      return;
    }

    const selection = selectAnalyzableDiff(
      fetched.diff,
      deps.config.auditMaxDiffAnalyzeBytes,
      fetched.omittedFiles,
    );
    const omitted = capOmittedFiles(
      selection.omittedFiles.map((file) => ({ ...file, path: redact(file.path) })),
    );
    const truncated =
      selection.truncated || fetched.truncated || selection.analyzedBytes < fetched.bytes || omitted.total > 0;
    const redactedDiff = redact(selection.analyzableDiff);
    const messages = buildAuditMessages({
      title: redact(context.pullRequest.title),
      commitSha: claimed.commit_sha,
      owner: context.repository.owner,
      repoName: context.repository.repo_name,
      prNumber: context.pullRequest.pr_number,
      analyzableDiff: redactedDiff,
      omittedFiles: omitted.stored,
      omittedTotal: omitted.total,
    });
    assertPromptHasNoCredential(messages, token);

    const modelResult = await completeAuditAnalysis(
      deps.ai,
      messages,
      deps.config.openaiModel,
      abort.signal,
    );
    throwIfAborted(abort.signal);

    const filtered = dropUnknownFileFlags(modelResult.output.security_flags, selection.analyzedPaths);
    if (filtered.dropped > 0) {
      log.info({ dropped_flags: filtered.dropped }, 'dropped security flags for unknown files');
    }
    const flags = filtered.flags.map((flag) => redactFlag(flag));
    const risk = deriveRiskLevel(flags);
    const notice = truncated ? partialAnalysisNotice(omitted.stored, omitted.total) : '';
    const documentation = redactOutputText(`${notice}${modelResult.output.documentation}`).trim();
    const summary = redactOutputText(modelResult.output.summary).trim();
    if (!documentation || !summary) {
      throw auditFailure('INTERNAL_ERROR', 500);
    }

    const wrote = await deps.audits.fencedUpdate(fence, {
      status: 'completed',
      risk_level: risk,
      summary,
      generated_documentation: documentation,
      ai_security_flags: flags,
      model: modelResult.model,
      prompt_version: AUDIT_PROMPT_VERSION,
      token_usage: modelResult.usage ?? { ...EMPTY_TOKEN_USAGE },
      diff_bytes: fetched.bytes,
      analyzed_diff_bytes: selection.analyzedBytes,
      files_changed: fetched.filesChanged,
      diff_truncated: truncated,
      diff_omitted_files: omitted.stored,
      duration_ms: durationMs(),
      completed_at: new Date().toISOString(),
      error_code: null,
      error_message: null,
    });
    if (!wrote) {
      log.warn('audit completion was skipped because the claim was lost');
      return;
    }
    log.info({ risk_level: risk, diff_truncated: truncated }, 'audit completed');
  } catch (error) {
    if (error instanceof FenceLostError || abort.signal.reason instanceof FenceLostError) {
      log.warn('audit processing stopped because the claim was lost');
      return;
    }
    if (isForeignKeyViolation(error) || error instanceof ForeignKeyViolationError) {
      log.warn('audit abandoned because a related row was deleted');
      return;
    }
    const code = auditErrorCodeFrom(error, abort.signal);
    await failAudit(deps, fence, code, durationMs(), log);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
  }
}

function fenceHolds(
  audit: { status: string; worker_id: string | null; attempts: number },
  fence: AuditFence,
): boolean {
  return audit.status === 'running' && audit.worker_id === fence.workerId && audit.attempts === fence.attempts;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new ProcessingTimeoutError();
  }
}

async function failAudit(
  deps: ProcessAuditDeps,
  fence: AuditFence,
  code: AuditErrorCode,
  durationMs: number,
  log: AppLogger,
): Promise<void> {
  const message = sanitizeErrorMessage(AUDIT_ERROR_MESSAGES[code]);
  try {
    const wrote = await deps.audits.fencedUpdate(fence, {
      status: 'failed',
      error_code: code,
      error_message: message,
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });
    if (!wrote) {
      log.warn({ error_code: code }, 'audit failure was not recorded because the claim was lost');
      return;
    }
    log.info({ error_code: code }, 'audit failed');
  } catch (error) {
    log.warn({ err: error instanceof Error ? error.name : 'error', error_code: code }, 'audit failure write failed');
  }
}

function assertPromptHasNoCredential(messages: { content: string }[], token: string): void {
  if (token.length < 8) {
    return;
  }
  const haystack = messages.map((message) => message.content).join('\n');
  if (haystack.includes(token)) {
    throw auditFailure('INTERNAL_ERROR', 500);
  }
}

