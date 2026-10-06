const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'narrow' });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function formatAbsolute(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return iso;
  }
  return absolute.format(time);
}

export function formatRelative(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return iso;
  }
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) {
    return relative.format(Math.round(seconds), 'second');
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return relative.format(minutes, 'minute');
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relative.format(hours, 'hour');
  }
  const days = Math.round(hours / 24);
  return relative.format(days, 'day');
}

export function formatDuration(ms: number): string {
  const safe = Math.max(0, Math.floor(ms));
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  if (totalSeconds > 0) {
    return `${totalSeconds}s`;
  }
  return `${safe}ms`;
}

export function formatKilobytes(bytes: number): string {
  const value = bytes / 1024;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function pageCount(total: number, limit: number): number {
  if (limit <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(total / limit));
}
