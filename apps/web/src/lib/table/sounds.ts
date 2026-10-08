import type { SoundKind } from '../sound';
import type { TableState } from './state';

function myTurn(s: TableState): boolean {
  return s.mySeat > 0 && s.hand?.toActSeat === s.mySeat && s.hand.street !== 'COMPLETE';
}

/**
 * The sounds a table change calls for (roadmap W1.6): a new hand or street
 * is dealt, chips go in, a check or fold, the viewer's turn, the viewer
 * winning. Snapshots (joining, resyncing) make no sound.
 */
export function soundsFor(prev: TableState, next: TableState): SoundKind[] {
  if (!prev.ready || !next.ready || next.seq <= prev.seq || prev.tableId !== next.tableId) {
    return [];
  }
  const out = new Set<SoundKind>();
  const ph = prev.hand;
  const nh = next.hand;
  if (nh && (!ph || nh.handNo !== ph.handNo)) out.add('deal');
  else if (nh && ph && nh.board.length > ph.board.length) out.add('deal');
  if (nh && ph && nh.handNo === ph.handNo && nh.street !== 'COMPLETE' && nh.pot > ph.pot) {
    out.add('chips');
  }
  for (const s of Object.values(next.seats)) {
    const before = prev.seats[s.seat];
    if (!s.lastAction || before?.lastAction === s.lastAction) continue;
    if (s.lastAction === 'CHECK') out.add('check');
    if (s.lastAction === 'FOLD') out.add('fold');
  }
  if (myTurn(next) && !(myTurn(prev) && prev.hand?.turnSeq === next.hand?.turnSeq)) {
    out.add('turn');
  }
  const last = next.lastHand;
  if (last && last.handId !== prev.lastHand?.handId) {
    const mine = last.results.find((r) => r.seat === next.mySeat);
    if (mine && mine.net > 0) out.add('win');
  }
  return [...out];
}
