import { AppError } from '../../utils/errors.js';

export interface OmittedFile {
  path: string;
  reason: 'size_budget' | 'no_patch' | 'binary' | 'fetch_cap';
}

export interface DiffFileChunk {
  path: string;
  text: string;
}

export interface DiffSelection {
  analyzableDiff: string;
  analyzedBytes: number;
  filesChanged: number;
  omittedFiles: OmittedFile[];
  analyzedPaths: string[];
  truncated: boolean;
}

const LOCKFILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'gemfile.lock',
  'cargo.lock',
  'composer.lock',
  'poetry.lock',
  'go.sum',
  'packages.lock.json',
  'gradle.lockfile',
  'podfile.lock',
  'package.resolved',
]);

const LOW_SIGNAL_DIR = /(^|\/)(dist|build|vendor|vendored|node_modules|third_party|third-party)\//;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|svg|pdf)$/i;

export function isLowSignalPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').toLowerCase();
  const base = normalized.split('/').pop() ?? normalized;
  if (LOCKFILES.has(base)) {
    return true;
  }
  if (base.endsWith('.min.js') || base.endsWith('.min.css') || base.endsWith('.map')) {
    return true;
  }
  if (base.includes('.generated.') || base.endsWith('.pb.go') || base.endsWith('.min.js')) {
    return true;
  }
  if (LOW_SIGNAL_DIR.test(normalized)) {
    return true;
  }
  return IMAGE_EXT.test(base);
}

export function splitUnifiedDiff(diff: string): DiffFileChunk[] {
  if (!diff.trim()) {
    return [];
  }
  const parts = diff.split(/(?=^diff --git )/m).filter((part) => part.trim().length > 0);
  return parts.map((part) => {
    const text = part.endsWith('\n') ? part : `${part}\n`;
    return { path: extractDiffPath(text), text };
  });
}

export function extractDiffPath(text: string): string {
  const line = text.split('\n')[0] ?? '';
  const quoted = /^diff --git "a\/(.*)" "b\/(.*)"$/.exec(line);
  if (quoted?.[2]) {
    return quoted[2];
  }
  const rest = line.startsWith('diff --git ') ? line.slice('diff --git '.length) : '';
  const separator = rest.lastIndexOf(' b/');
  if (separator >= 0) {
    return rest.slice(separator + 3);
  }
  return 'unknown';
}

/**
 * Keep whole files, normal sources first (original order), low-signal files last.
 * A file that does not fit is skipped (`size_budget`) and later smaller files are still considered.
 * Throws DIFF_EMPTY or DIFF_TOO_LARGE.
 */
export function selectAnalyzableDiff(
  diff: string,
  budgetBytes: number,
  alreadyOmitted: readonly OmittedFile[] = [],
  extraFileCount = 0,
): DiffSelection {
  const chunks = splitUnifiedDiff(diff);
  if (chunks.length === 0 && !diff.trim()) {
    throw new AppError(422, 'DIFF_EMPTY', 'The pull request diff is empty, so there is nothing to analyze.');
  }

  const normal: DiffFileChunk[] = [];
  const lowSignal: DiffFileChunk[] = [];
  for (const chunk of chunks) {
    if (isLowSignalPath(chunk.path)) {
      lowSignal.push(chunk);
    } else {
      normal.push(chunk);
    }
  }
  const ordered = [...normal, ...lowSignal];

  const included: DiffFileChunk[] = [];
  const omitted: OmittedFile[] = [...alreadyOmitted];
  let used = 0;

  for (const chunk of ordered) {
    const size = Buffer.byteLength(chunk.text, 'utf8');
    if (used + size <= budgetBytes) {
      included.push(chunk);
      used += size;
    } else {
      omitted.push({ path: chunk.path, reason: 'size_budget' });
    }
  }

  if (included.length === 0) {
    throw new AppError(422, 'DIFF_TOO_LARGE', 'The pull request diff is too large to analyze.');
  }

  const analyzableDiff = included.map((chunk) => chunk.text).join('');
  const analyzedBytes = Buffer.byteLength(analyzableDiff, 'utf8');
  const filesChanged = chunks.length + extraFileCount;
  const truncated = omitted.length > 0 || analyzedBytes < Buffer.byteLength(diff, 'utf8');

  return {
    analyzableDiff,
    analyzedBytes,
    filesChanged,
    omittedFiles: omitted,
    analyzedPaths: included.map((chunk) => chunk.path),
    truncated,
  };
}
