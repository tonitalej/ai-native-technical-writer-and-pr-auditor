import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { EncryptionService } from '../../src/services/encryption/encryptionService.js';

const SECRET = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

describe('encryption', () => {
  it('round-trips a token and uses the v1 format', () => {
    const service = new EncryptionService(randomBytes(32));
    const encrypted = service.encrypt(SECRET, { repoId: 'repo-a' });
    expect(encrypted.keyId).toBe('app-v1');
    expect(encrypted.ciphertext.split('.')).toHaveLength(4);
    expect(encrypted.ciphertext.startsWith('v1.')).toBe(true);
    expect(service.decrypt(encrypted.ciphertext, encrypted.keyId, { repoId: 'repo-a' })).toBe(SECRET);
    const again = service.encrypt(SECRET, { repoId: 'repo-a' });
    expect(again.ciphertext).not.toBe(encrypted.ciphertext);
  });

  it('rejects a tampered ciphertext without revealing the plaintext', () => {
    const service = new EncryptionService(randomBytes(32));
    const encrypted = service.encrypt(SECRET, { repoId: 'repo-a' });
    const parts = encrypted.ciphertext.split('.');
    const body = parts[3] ?? '';
    parts[3] = body.startsWith('A') ? `B${body.slice(1)}` : `A${body.slice(1)}`;
    expect(() => service.decrypt(parts.join('.'), encrypted.keyId, { repoId: 'repo-a' })).toThrow(
      /internal error/i,
    );
  });

  it('rejects a wrong key, a row swap, and an unknown key id', () => {
    const service = new EncryptionService(randomBytes(32));
    const encrypted = service.encrypt(SECRET, { repoId: 'repo-a' });
    const other = new EncryptionService(randomBytes(32));
    expect(() => other.decrypt(encrypted.ciphertext, encrypted.keyId, { repoId: 'repo-a' })).toThrow(
      /internal error/i,
    );
    expect(() => service.decrypt(encrypted.ciphertext, encrypted.keyId, { repoId: 'repo-b' })).toThrow(
      /internal error/i,
    );
    try {
      service.decrypt(encrypted.ciphertext, 'app-v2', { repoId: 'repo-a' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(SECRET);
      expect((error as Error).message).not.toContain(encrypted.ciphertext);
    }
  });
});
