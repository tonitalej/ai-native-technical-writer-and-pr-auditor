import { redact } from '../../utils/redact.js';
import type { SecurityFlag } from './schema.js';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

const RISK_RANK: Record<Exclude<SecurityFlag['severity'], 'info'> | 'none', number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const RISK_BY_RANK: RiskLevel[] = ['none', 'low', 'medium', 'high', 'critical'];

export function normalizeRepoPath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function dropUnknownFileFlags(
  flags: readonly SecurityFlag[],
  analyzedPaths: readonly string[],
): { flags: SecurityFlag[]; dropped: number } {
  const allowed = new Set(analyzedPaths.map((path) => normalizeRepoPath(path)));
  const kept: SecurityFlag[] = [];
  let dropped = 0;
  for (const flag of flags) {
    if (flag.file !== null && !allowed.has(normalizeRepoPath(flag.file))) {
      dropped += 1;
      continue;
    }
    kept.push(flag);
  }
  return { flags: kept, dropped };
}

export function deriveRiskLevel(flags: readonly Pick<SecurityFlag, 'severity'>[]): RiskLevel {
  let best = 0;
  for (const flag of flags) {
    if (flag.severity === 'info') {
      continue;
    }
    const rank = RISK_RANK[flag.severity];
    if (rank > best) {
      best = rank;
    }
  }
  return RISK_BY_RANK[best] ?? 'none';
}

export function redactFlag(flag: SecurityFlag): SecurityFlag {
  return {
    ...flag,
    title: redact(flag.title),
    description: redact(flag.description),
    recommendation: redact(flag.recommendation),
    file: flag.file === null ? null : redact(flag.file),
  };
}

export function redactOutputText(value: string): string {
  return redact(value);
}
