import type { ReactNode } from 'react';

import { httpsUrl } from '../lib/safeUrl';

export function SafeLink({ href, children }: { href: string | null; children: ReactNode }) {
  const safe = httpsUrl(href);
  if (!safe) {
    return <span>{children}</span>;
  }
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
