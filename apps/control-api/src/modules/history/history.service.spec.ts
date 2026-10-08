import type { ParticipantRow } from './history.repository';
import { withShownCards } from './history.service';

const player = (seat: number, shownCards: string[] | null): ParticipantRow => ({
  seat,
  userId: `u${seat}`,
  username: `p${seat}`,
  startingStack: 100,
  endingStack: 100,
  contributed: 0,
  won: 0,
  net: 0,
  folded: false,
  shownCards,
});

describe('withShownCards', () => {
  it('adds cards shown after the hand to those shown at showdown', () => {
    const players = [player(1, null), player(2, ['Ah', 'Kd']), player(3, null)];
    const events = [
      { event: { kind: 'POT_AWARDED', seat: 1 } },
      { event: { kind: 'CARDS_SHOWN', seat: 1, cards: ['Qs'] } },
      { event: { kind: 'CARDS_SHOWN', seat: 1, cards: ['Qc'] } },
      { event: { kind: 'CARDS_SHOWN', seat: 2, cards: ['Ah'] } },
    ];
    const out = withShownCards(players, events);
    expect(out.map((p) => p.shownCards)).toEqual([['Qs', 'Qc'], ['Ah', 'Kd'], null]);
    expect(withShownCards(players, [])).toBe(players);
  });
});
