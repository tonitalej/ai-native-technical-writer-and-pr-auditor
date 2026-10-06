import { describe, expect, it } from 'vitest';

import { redact } from '../../src/utils/redact.js';

describe('redact', () => {
  it('replaces high-confidence secret shapes and leaves ordinary code', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlMTIzNDU2Nzg';
    const input = [
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11AAAAAAA012345678901234567890',
      'AKIAIOSFODNN7EXAMPLE',
      'sk-proj-abcdefghijklmnopqrstuvwxyz',
      'xoxb-1234567890-abcdefghij',
      pem,
      jwt,
      'const value = "not-a-secret";',
    ].join('\n');
    const output = redact(input);
    expect(output).toContain('[REDACTED:github-token]');
    expect(output).toContain('[REDACTED:aws-access-key]');
    expect(output).toContain('[REDACTED:api-key]');
    expect(output).toContain('[REDACTED:slack-token]');
    expect(output).toContain('[REDACTED:private-key]');
    expect(output).toContain('[REDACTED:jwt]');
    expect(output).toContain('const value = "not-a-secret";');
    expect(output).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(output).not.toContain('BEGIN RSA PRIVATE KEY');
  });
});
