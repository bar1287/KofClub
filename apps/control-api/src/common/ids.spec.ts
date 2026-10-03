import { isUuid, uuidv7 } from './ids';
import { CODE_ALPHABET, constantTimeEqual, randomCode, randomToken } from './crypto';

describe('uuidv7', () => {
  it('produces valid, time-ordered v7 uuids', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(a[19]);
    expect(a < b).toBe(true);
  });

  it('is unique', () => {
    const set = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(set.size).toBe(1000);
  });
});

describe('crypto helpers', () => {
  it('random codes use the unambiguous alphabet', () => {
    const code = randomCode(64);
    expect(code).toHaveLength(64);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
  });

  it('random tokens carry a prefix and 256 bits', () => {
    const t = randomToken('rt');
    expect(t.startsWith('rt_')).toBe(true);
    expect(Buffer.from(t.slice(3), 'base64url')).toHaveLength(32);
  });

  it('constantTimeEqual compares content', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });
});
