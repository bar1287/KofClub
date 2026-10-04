import { readFileSync } from 'node:fs';
import path from 'node:path';
import { blindLevels, levelAt, prizes, tableCount } from './structure';

interface Golden {
  structures: Array<{ smallBlind: number; bigBlind: number; levels: Array<[number, number]> }>;
  prizes: Array<{ entrants: number; pool: number; prizes: number[] }>;
}

const golden = JSON.parse(
  readFileSync(
    path.resolve(__dirname, '../../../../../go/tournament/testdata/golden.json'),
    'utf8',
  ),
) as Golden;

describe('tournament structure (mirror of go/tournament)', () => {
  it('matches the Go blind schedule', () => {
    for (const g of golden.structures) {
      const levels = blindLevels(
        { smallBlind: g.smallBlind, bigBlind: g.bigBlind, levelDurationSec: 60 },
        g.levels.length,
      );
      expect(levels.map((l) => [l.smallBlind, l.bigBlind])).toEqual(g.levels);
    }
  });

  it('matches the Go payout table', () => {
    for (const g of golden.prizes) {
      expect(prizes(g.entrants, g.pool)).toEqual(g.prizes);
    }
  });

  it('finds the level for elapsed time', () => {
    const s = { smallBlind: 10, bigBlind: 20, levelDurationSec: 60 };
    expect(levelAt(s, 0)).toEqual({
      level: { level: 1, smallBlind: 10, bigBlind: 20 },
      endsInMs: 60000,
    });
    expect(levelAt(s, 90_000)).toEqual({
      level: { level: 2, smallBlind: 15, bigBlind: 30 },
      endsInMs: 30000,
    });
    expect(tableCount(7, 3)).toBe(3);
  });
});
