import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SafeMarkdown } from '../../src/components/markdown/SafeMarkdown';
import { SafeLink } from '../../src/components/SafeLink';
import { httpsUrl } from '../../src/lib/safeUrl';
import { auditPollDelay } from '../../src/lib/polling';

describe('markdown and urls', () => {
  it('does not render raw html, images, or javascript links', () => {
    const { container } = render(
      <SafeMarkdown
        source={'Hello\n\n<script>alert(1)</script>\n\n<img src="https://evil.test/x.png" alt="secret" />\n\n[click](javascript:alert(1))\n\n![pic](https://evil.test/a.png)\n\n[docs](https://example.com/docs)'}
      />,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'docs' }).getAttribute('href')).toBe('https://example.com/docs');
    expect(screen.getByRole('link', { name: 'docs' }).getAttribute('rel')).toContain('noopener');
  });

  it('does not link a non-https html url', () => {
    expect(httpsUrl('http://github.com/octocat/hello')).toBeNull();
    expect(httpsUrl('javascript:alert(1)')).toBeNull();
    render(<SafeLink href="http://github.com/octocat/hello">View on GitHub</SafeLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('View on GitHub')).toBeTruthy();
  });
});

describe('audit polling delay', () => {
  it('starts at 2 seconds, slows to 5, and stops at 10 minutes or a terminal state', () => {
    expect(auditPollDelay('pending', 0, false)).toBe(2000);
    expect(auditPollDelay('running', 30_000, false)).toBe(5000);
    expect(auditPollDelay('running', 10 * 60 * 1000, false)).toBe(false);
    expect(auditPollDelay('completed', 0, false)).toBe(false);
    expect(auditPollDelay('failed', 1000, false)).toBe(false);
    expect(auditPollDelay('pending', 0, true)).toBe(false);
  });
});
