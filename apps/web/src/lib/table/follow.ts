import type { TournamentDetail } from '../types';

/**
 * How often a tournament player watching a table without a seat there asks
 * the tournament where they play.
 */
export const FOLLOW_INTERVAL_MS = 3000;

export type FollowDecision = { go: string } | 'wait' | 'stop';

/**
 * Decides where a tournament player who watches `tableId` without a seat
 * should be. A PLAYER_LEFT MOVED event is the fast path, but a client that
 * subscribes just after the table moved them on (or redirected them before
 * they arrived) only gets a snapshot without them. The tournament knows their
 * current table:
 *
 * - `{ go }`: they play (or are on the way to) another table.
 * - `'wait'`: they are about to be seated here.
 * - `'stop'`: they no longer play (spectator, eliminated, tournament over).
 */
export function followDecision(
  t: Pick<TournamentDetail, 'status' | 'myTableId'>,
  tableId: string,
): FollowDecision {
  if (t.status !== 'RUNNING' || !t.myTableId) return 'stop';
  return t.myTableId === tableId ? 'wait' : { go: t.myTableId };
}
