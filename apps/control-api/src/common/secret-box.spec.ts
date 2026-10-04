import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));

  it('round-trips and binds the context', () => {
    const secret = randomBytes(20);
    const sealed = box.seal(secret, 'user-1');
    expect(sealed.includes(secret)).toBe(false);
    expect(box.open(sealed, 'user-1').equals(secret)).toBe(true);
    expect(() => box.open(sealed, 'user-2')).toThrow();
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1]! ^= 1;
    expect(() => box.open(tampered, 'user-1')).toThrow();
    expect(box.seal(secret, 'user-1').subarray(0, 12).equals(sealed.subarray(0, 12))).toBe(false);
  });

  it('rejects keys of the wrong size and a different key', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow();
    const other = new SecretBox(randomBytes(32).toString('base64'));
    expect(() => other.open(box.seal(Buffer.from('x'), 'u'), 'u')).toThrow();
  });
});
