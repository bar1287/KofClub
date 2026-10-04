import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for small secrets at rest (node:crypto). Ciphertexts are bound
 * to a context string (associated data, e.g. the owning user id), so they
 * cannot be moved to another row. Layout: nonce || ciphertext || tag.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(keyB64: string) {
    this.key = Buffer.from(keyB64, 'base64');
    if (this.key.length !== 32) throw new Error('secret box key must be 32 bytes (base64)');
  }

  seal(plaintext: Buffer, context: string): Buffer {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([nonce, body, cipher.getAuthTag()]);
  }

  /** Throws when the data or its context were tampered with. */
  open(sealed: Buffer, context: string): Buffer {
    if (sealed.length < NONCE_BYTES + TAG_BYTES)
      throw new Error('secret box: ciphertext too short');
    const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, NONCE_BYTES));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES)),
      decipher.final(),
    ]);
  }
}
