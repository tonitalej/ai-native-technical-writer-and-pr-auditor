import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { CURRENT_ENCRYPTION_KEY_ID } from '../../config/constants.js';
import { AppError } from '../../utils/errors.js';

export interface EncryptResult {
  ciphertext: string;
  keyId: string;
}

export interface EncryptionAad {
  repoId: string;
}

/**
 * AES-256-GCM with a key ring keyed by `encryption_key_id`.
 * Serialization: `v1.<iv>.<authTag>.<ciphertext>` (base64url).
 * AAD is `repo:<repo_id>`, so a ciphertext copied onto another row fails to decrypt.
 */
export class EncryptionService {
  private readonly keys = new Map<string, Buffer>();

  constructor(currentKey: Buffer) {
    if (currentKey.length !== 32) {
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }
    this.keys.set(CURRENT_ENCRYPTION_KEY_ID, Buffer.from(currentKey));
  }

  encrypt(plaintext: string, aad: EncryptionAad): EncryptResult {
    const key = this.requireKey(CURRENT_ENCRYPTION_KEY_ID);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aadBuffer(aad.repoId));
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
    return { ciphertext, keyId: CURRENT_ENCRYPTION_KEY_ID };
  }

  decrypt(ciphertext: string, keyId: string, aad: EncryptionAad): string {
    try {
      const key = this.keys.get(keyId);
      if (!key) {
        throw new Error('unknown key');
      }
      const parts = ciphertext.split('.');
      if (parts.length !== 4 || parts[0] !== 'v1') {
        throw new Error('format');
      }
      const ivPart = parts[1];
      const tagPart = parts[2];
      const dataPart = parts[3];
      if (!ivPart || !tagPart || !dataPart) {
        throw new Error('format');
      }
      const iv = Buffer.from(ivPart, 'base64url');
      const tag = Buffer.from(tagPart, 'base64url');
      const data = Buffer.from(dataPart, 'base64url');
      if (iv.length !== 12 || tag.length !== 16 || data.length === 0) {
        throw new Error('lengths');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aadBuffer(aad.repoId));
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]);
      return plain.toString('utf8');
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(500, 'INTERNAL_ERROR', 'An internal error occurred.');
    }
  }

  private requireKey(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new AppError(500, 'INTERNAL_ERROR', 'An internal error occurred.');
    }
    return key;
  }
}

function aadBuffer(repoId: string): Buffer {
  return Buffer.from(`repo:${repoId}`, 'utf8');
}
