import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords (HMAC-SHA1, 30-second steps) on
 * node:crypto, plus the RFC 4648 base32 encoding authenticator apps use for
 * secrets. Verified against the RFC test vectors (totp.spec.ts).
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The time step of a moment (Unix ms). */
export function timeStep(unixMs: number): number {
  return Math.floor(unixMs / 1000 / TOTP_STEP_SECONDS);
}

/** HOTP value of `step` (RFC 4226 dynamic truncation). */
export function hotp(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function totp(secret: Buffer, unixMs: number, digits = TOTP_DIGITS): string {
  return hotp(secret, timeStep(unixMs), digits);
}

/**
 * Returns the time step a code matches (current step, or one step either
 * side for clock drift), or null. Steps at or below `afterStep` are not
 * accepted, so a code works once.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  unixMs: number,
  afterStep = 0,
  window = 1,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = timeStep(unixMs);
  for (let step = now - window; step <= now + window; step++) {
    if (step <= afterStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// URI understood by authenticator apps (Key Uri Format). */
export function otpauthUri(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
