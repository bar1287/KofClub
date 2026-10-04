import { groupSecret } from './TwoFactorPanel';

describe('groupSecret', () => {
  it('groups a base32 secret in fours for manual entry', () => {
    expect(groupSecret('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupSecret('ABCDEF')).toBe('ABCD EF');
    expect(groupSecret('')).toBe('');
  });
});
