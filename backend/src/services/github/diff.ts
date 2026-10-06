import { AppError } from '../../utils/errors.js';
import { normalizeSha } from '../../utils/sha.js';
import type { ProviderDiff } from '../../types/provider.js';
import type { OmittedFile } from '../audits/diffSelection.js';
import { GitHubClient, isDiffTooLargeResponse } from './githubClient.js';
import { githubPullFileListSchema, type GithubPullFile } from './githubSchemas.js';
import { BodyTooLargeError, decodeUtf8, readBodyWithCap } from './readBody.js';
import { GITHUB_FILES_MAX_PAGES, GITHUB_FILES_PER_PAGE } from '../../config/constants.js';

const DIFF_ACCEPT = 'application/vnd.github.diff';

export async function fetchPullRequestDiff(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  prNumber: number;
  expectedHeadSha: string;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<ProviderDiff> {
  normalizeSha(input.expectedHeadSha);
  const path = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.prNumber}`;
  const response = await input.client.request(path, {
    accept: DIFF_ACCEPT,
    signal: input.signal,
    passThroughStatuses: [406, 422],
  });

  if (response.status === 406) {
    await response.body?.cancel().catch(() => undefined);
    return fetchDiffFromFiles(input);
  }

  if (response.status === 422) {
    const sampleBytes = await readBodyWithCap(response, 8_192, input.signal).catch(() => new Uint8Array());
    const sample = decodeUtf8(sampleBytes instanceof Uint8Array ? sampleBytes : new Uint8Array());
    if (isDiffTooLargeResponse(422, sample)) {
      return fetchDiffFromFiles(input);
    }
    throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
  }

  if (!response.ok) {
    throw new AppError(502, 'PROVIDER_UNAVAILABLE', 'GitHub is temporarily unavailable.');
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyWithCap(response, input.maxBytes, input.signal);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new AppError(422, 'DIFF_TOO_LARGE', 'The pull request diff is too large to analyze.');
    }
    throw error;
  }

  const diff = decodeUtf8(bytes);
  if (!diff.trim()) {
    throw new AppError(422, 'DIFF_EMPTY', 'The pull request diff is empty, so there is nothing to analyze.');
  }

  const fileCount = diff.split('\n').filter((line) => line.startsWith('diff --git ')).length;
  return {
    diff,
    filesChanged: fileCount > 0 ? fileCount : 1,
    bytes: Buffer.byteLength(diff, 'utf8'),
    omittedFiles: [],
    viaFallback: false,
    truncated: false,
  };
}

async function fetchDiffFromFiles(input: {
  client: GitHubClient;
  owner: string;
  repo: string;
  prNumber: number;
  maxBytes: number;
  signal?: AbortSignal;
}): Promise<ProviderDiff> {
  const files: GithubPullFile[] = [];
  for (let page = 1; page <= GITHUB_FILES_MAX_PAGES; page += 1) {
    const batch = await input.client.requestJson(
      `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pulls/${input.prNumber}/files`,
      githubPullFileListSchema,
      {
        signal: input.signal,
        query: { per_page: GITHUB_FILES_PER_PAGE, page },
      },
    );
    files.push(...batch);
    if (batch.length < GITHUB_FILES_PER_PAGE) {
      break;
    }
  }

  let assembled = '';
  const omitted: OmittedFile[] = [];
  let truncated = false;

  for (const file of files) {
    if (truncated) {
      omitted.push({ path: file.filename, reason: 'fetch_cap' });
      continue;
    }
    const rendered = renderFileDiff(file);
    if (rendered.kind === 'omit') {
      omitted.push({ path: file.filename, reason: rendered.reason });
      continue;
    }
    const next = assembled + rendered.text;
    if (Buffer.byteLength(next, 'utf8') > input.maxBytes) {
      truncated = true;
      omitted.push({ path: file.filename, reason: 'fetch_cap' });
      continue;
    }
    assembled = next;
  }

  if (!assembled.trim()) {
    throw new AppError(422, 'DIFF_EMPTY', 'The pull request diff is empty, so there is nothing to analyze.');
  }

  return {
    diff: assembled,
    filesChanged: files.length,
    bytes: Buffer.byteLength(assembled, 'utf8'),
    omittedFiles: omitted,
    viaFallback: true,
    truncated: truncated || omitted.length > 0,
  };
}

function renderFileDiff(
  file: GithubPullFile,
): { kind: 'text'; text: string } | { kind: 'omit'; reason: 'binary' | 'no_patch' } {
  if (!file.patch) {
    return { kind: 'omit', reason: classifyMissingPatch(file) };
  }
  const previous = file.previous_filename ?? file.filename;
  const patch = file.patch.endsWith('\n') ? file.patch : `${file.patch}\n`;
  return {
    kind: 'text',
    text: `diff --git a/${previous} b/${file.filename}\n${patch}`,
  };
}

/**
 * `binary` only with positive evidence. A missing patch by itself is `no_patch`.
 * Evidence is an explicit binary flag, or status renamed/copied/changed with no patch
 * and either a previous filename or a zero line-count size signal.
 */
function classifyMissingPatch(file: GithubPullFile): 'binary' | 'no_patch' {
  if (file.binary === true) {
    return 'binary';
  }
  const binaryStatus = file.status === 'renamed' || file.status === 'copied' || file.status === 'changed';
  const sizeSignal =
    Boolean(file.previous_filename) || (file.additions === 0 && file.deletions === 0);
  if (binaryStatus && sizeSignal) {
    return 'binary';
  }
  return 'no_patch';
}
