import type { Card } from '../types';
import type { TableState } from './state';

/**
 * Cards the viewer can still show from the hand that just ended (roadmap
 * W1.5): their hole cards not already public, until the next hand starts.
 * Hands shown at showdown have nothing left to show; the server decides.
 */
export function cardsToShow(state: TableState): Card[] {
  const seat = state.seats[state.mySeat];
  if (!seat || !seat.inHand || state.hand?.street !== 'COMPLETE') return [];
  const shown = seat.shownCards ?? [];
  return state.holeCards.filter((c) => !shown.includes(c));
}
