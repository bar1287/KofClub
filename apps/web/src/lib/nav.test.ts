import { safeNext } from './nav';

describe('safeNext', () => {
  it('follows local paths only', () => {
    expect(safeNext('/tables/abc')).toBe('/tables/abc');
    expect(safeNext(null)).toBe('/clubs');
    expect(safeNext('https://evil.example')).toBe('/clubs');
    expect(safeNext('//evil.example')).toBe('/clubs');
    expect(safeNext('/\\evil.example')).toBe('/clubs');
  });
});
