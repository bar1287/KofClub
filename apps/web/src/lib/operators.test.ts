import { slugFromName } from './operators';

describe('slugFromName', () => {
  it('suggests a valid operator address from a service name', () => {
    expect(slugFromName('Alpha Poker')).toBe('alpha-poker');
    expect(slugFromName('  Café  Royale!! ')).toBe('cafe-royale');
    expect(slugFromName('פוקר')).toBe('');
    expect(slugFromName('x'.repeat(50))).toHaveLength(32);
  });
});
