import { followDecision } from './follow';

const HERE = '00000000-0000-4000-8000-000000000001';
const THERE = '00000000-0000-4000-8000-000000000002';

describe('followDecision', () => {
  it('follows a player whose tournament table is elsewhere', () => {
    expect(followDecision({ status: 'RUNNING', myTableId: THERE }, HERE)).toEqual({ go: THERE });
  });

  it('waits while the player is about to be seated here', () => {
    expect(followDecision({ status: 'RUNNING', myTableId: HERE }, HERE)).toBe('wait');
  });

  it('stops for spectators, eliminated players and finished tournaments', () => {
    expect(followDecision({ status: 'RUNNING', myTableId: null }, HERE)).toBe('stop');
    expect(followDecision({ status: 'FINISHED', myTableId: null }, HERE)).toBe('stop');
  });
});
