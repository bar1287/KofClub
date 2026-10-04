import { base32Decode, base32Encode, hotp, otpauthUri, totp, verifyTotp } from './totp';

// RFC 6238 Appendix B (SHA-1 rows), 8-digit values.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
    }
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314'];
    expected.forEach((code, counter) => expect(hotp(RFC_SECRET, counter)).toBe(code));
  });

  it('accepts one step of drift, rejects others, and each code only once', () => {
    const now = 1_700_000_000_000;
    const code = totp(RFC_SECRET, now);
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, now + 30_000)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, now - 30_000)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, now + 60_000)).toBeNull();
    // Replay: the step was used.
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBeNull();
  });
});

describe('base32', () => {
  it('matches RFC 4648 vectors and round-trips', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZ1')).toThrow();
  });

  it('builds an otpauth URI', () => {
    expect(otpauthUri('KofClub', 'alice', 'MZXW6YTBOI')).toBe(
      'otpauth://totp/KofClub%3Aalice?secret=MZXW6YTBOI&issuer=KofClub&algorithm=SHA1&digits=6&period=30',
    );
  });
});
