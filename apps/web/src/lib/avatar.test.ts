import { avatarFor } from './avatar';

describe('avatarFor', () => {
  it('is stable per seed, mirrored and never blank', () => {
    const a = avatarFor('0191a000-0000-7000-8000-00000000000a');
    expect(avatarFor('0191a000-0000-7000-8000-00000000000a')).toEqual(a);
    expect(a.hue).toBeGreaterThanOrEqual(0);
    expect(a.hue).toBeLessThan(360);
    for (let i = 0; i < 200; i++) {
      const { cells } = avatarFor(`user-${i}`);
      expect(cells).toHaveLength(5);
      for (const row of cells) {
        expect(row).toHaveLength(5);
        expect(row[0]).toBe(row[4]);
        expect(row[1]).toBe(row[3]);
      }
      expect(cells.flat().some(Boolean)).toBe(true);
    }
  });

  it('differs between players', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(JSON.stringify(avatarFor(`user-${i}`)));
    expect(seen.size).toBeGreaterThan(95);
  });
});
