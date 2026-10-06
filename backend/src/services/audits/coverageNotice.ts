import { DIFF_NOTICE_LIST_LIMIT, DIFF_OMITTED_FILES_CAP } from '../../config/constants.js';
import type { OmittedFile } from './diffSelection.js';

export function capOmittedFiles(files: readonly OmittedFile[]): {
  stored: OmittedFile[];
  total: number;
} {
  return {
    stored: files.slice(0, DIFF_OMITTED_FILES_CAP),
    total: files.length,
  };
}

/** Deterministic notice prepended when coverage is partial. Lists paths, or a count above 20. */
export function partialAnalysisNotice(files: readonly OmittedFile[], total: number): string {
  if (total <= 0) {
    return '';
  }
  if (total > DIFF_NOTICE_LIST_LIMIT) {
    return `> **Partial analysis.** ${total} files were omitted and were not analyzed. This documentation covers only the files that were provided.\n\n`;
  }
  const lines = files.map((file) => `> - ${file.path}`).join('\n');
  return `> **Partial analysis.** The following files were omitted and were not analyzed:\n${lines}\n>\n> This documentation covers only the files that were provided.\n\n`;
}
