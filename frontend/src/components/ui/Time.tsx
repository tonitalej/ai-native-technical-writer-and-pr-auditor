import { formatAbsolute, formatRelative } from '../../lib/format';

export function Time({ value }: { value: string | null }) {
  if (!value) {
    return <span>Not yet</span>;
  }
  return (
    <time dateTime={value} title={formatAbsolute(value)}>
      {formatRelative(value)}
    </time>
  );
}
