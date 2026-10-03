import { joinUrl } from './env';

describe('joinUrl', () => {
  it('normalizes slashes', () => {
    expect(joinUrl('http://x/', '/v1/me')).toBe('http://x/v1/me');
    expect(joinUrl('http://x', 'v1/me')).toBe('http://x/v1/me');
  });
});
