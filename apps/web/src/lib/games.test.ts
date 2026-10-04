import { gameLabel, gameName, holeCardCount } from './games';

describe('games', () => {
  it('describes each game', () => {
    expect(holeCardCount('NLHE')).toBe(2);
    expect(holeCardCount('PLO')).toBe(4);
    expect(holeCardCount(undefined)).toBe(2);
    expect(gameLabel('PLO')).toBe('PL Omaha');
    expect(gameName('NLHE')).toBe("No-Limit Texas Hold'em");
  });
});
