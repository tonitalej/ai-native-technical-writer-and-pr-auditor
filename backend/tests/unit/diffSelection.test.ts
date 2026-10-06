import { describe, expect, it } from 'vitest';

import { isLowSignalPath, selectAnalyzableDiff } from '../../src/services/audits/diffSelection.js';
import { partialAnalysisNotice } from '../../src/services/audits/coverageNotice.js';
import { deriveRiskLevel } from '../../src/services/ai/postProcess.js';

function fileDiff(path: string, bytes: number): string {
  const body = 'x'.repeat(Math.max(0, bytes - `diff --git a/${path} b/${path}\n`.length));
  return `diff --git a/${path} b/${path}\n${body}\n`;
}

describe('diff selection', () => {
  it('orders low-signal files last and skips files that do not fit', () => {
    const source = 'diff --git a/src/app.ts b/src/app.ts\n+abc\n';
    const other = 'diff --git a/src/small.ts b/src/small.ts\n+z\n';
    const lock = `diff --git a/package-lock.json b/package-lock.json\n${'x'.repeat(200)}\n`;
    const diff = `${lock}${source}${other}`;
    const selected = selectAnalyzableDiff(diff, Buffer.byteLength(source) + Buffer.byteLength(other));
    expect(selected.analyzedPaths).toEqual(['src/app.ts', 'src/small.ts']);
    expect(selected.omittedFiles.map((file) => file.path)).toContain('package-lock.json');
    expect(selected.truncated).toBe(true);
    expect(isLowSignalPath('dist/app.js')).toBe(true);
    expect(isLowSignalPath('src/app.ts')).toBe(false);
  });

  it('fails when nothing fits and when the diff is empty', () => {
    expect(() => selectAnalyzableDiff(fileDiff('src/huge.ts', 500), 10)).toThrow(/too large/i);
    expect(() => selectAnalyzableDiff('   ', 100)).toThrow(/empty/i);
  });

  it('builds a partial-analysis notice from omitted files', () => {
    const few = partialAnalysisNotice([{ path: 'a.ts', reason: 'size_budget' }], 1);
    expect(few).toContain('a.ts');
    expect(few).toContain('Partial analysis');
    const many = partialAnalysisNotice(
      Array.from({ length: 21 }, (_, index) => ({ path: `f${index}.ts`, reason: 'size_budget' as const })),
      21,
    );
    expect(many).toContain('21 files');
    expect(many).not.toContain('f0.ts');
  });

  it('derives risk from the highest non-info severity', () => {
    expect(deriveRiskLevel([])).toBe('none');
    expect(deriveRiskLevel([{ severity: 'info' }])).toBe('none');
    expect(deriveRiskLevel([{ severity: 'low' }, { severity: 'high' }, { severity: 'info' }])).toBe('high');
    expect(deriveRiskLevel([{ severity: 'critical' }])).toBe('critical');
  });
});
