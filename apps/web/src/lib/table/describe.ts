import { ordinal } from '../format';
import type { EventOf, TableEventPayload } from '../types';

const VERB: Record<EventOf<'PLAYER_ACTED'>['action'], string> = {
  FOLD: 'folds',
  CHECK: 'checks',
  CALL: 'calls',
  BET: 'bets',
  RAISE: 'raises to',
};

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/**
 * Human-readable line for a public table event (live log and hand history).
 * `name` resolves a seat to a username. Returns null for events that are
 * not worth a log line (cards dealt, turn changes).
 */
export function describeEvent(
  ev: TableEventPayload,
  name: (seat: number) => string,
): string | null {
  switch (ev.kind) {
    case 'PLAYER_SEATED':
      return `${ev.username} sits down with ${ev.stack}.`;
    case 'PLAYER_LEFT':
      switch (ev.reason) {
        case 'BUSTED':
          return `${name(ev.seat)} is out of chips and leaves.`;
        case 'TABLE_CLOSED':
          return `${name(ev.seat)} is cashed out (${ev.cashOut} back to wallet).`;
        case 'MOVED':
          // Seat 0: redirected before sitting down here; nothing to show.
          return ev.seat === 0 ? null : `${name(ev.seat)} moves to another table.`;
        case 'ELIMINATED':
          return `${name(ev.seat)} is eliminated in ${ordinal(ev.place ?? 0)} place.`;
        case 'FINISHED':
          return ev.place === 1
            ? `${name(ev.seat)} wins the tournament!`
            : `${name(ev.seat)} finishes in ${ordinal(ev.place ?? 0)} place.`;
        default:
          return `${name(ev.seat)} leaves the table (${ev.cashOut} back to wallet).`;
      }
    case 'PLAYER_SITTING_OUT': {
      const why = ev.reason === 'TIMEOUTS' ? ' (timed out)' : '';
      return ev.sittingOut ? `${name(ev.seat)} sits out${why}.` : `${name(ev.seat)} is back.`;
    }
    case 'HAND_STARTED':
      return ev.tournament
        ? `Hand #${ev.handNo} begins (level ${ev.tournament.level}, blinds ${ev.tournament.smallBlind}/${ev.tournament.bigBlind}).`
        : `Hand #${ev.handNo} begins.`;
    case 'BLIND_POSTED':
      return `${name(ev.seat)} posts the ${ev.blind === 'SMALL' ? 'small' : 'big'} blind ${ev.amount}.`;
    case 'HOLE_CARDS_DEALT':
    case 'TURN_STARTED':
      return null;
    case 'TIME_BANK_STARTED':
      return `${name(ev.seat)} is using the time bank (${Math.round(ev.timeoutMs / 1000)}s).`;
    case 'PLAYER_ACTED': {
      const amount = ev.action === 'CALL' ? ev.added : ev.streetBet;
      const label =
        ev.action === 'FOLD' || ev.action === 'CHECK'
          ? VERB[ev.action]
          : `${VERB[ev.action]} ${amount}`;
      return `${name(ev.seat)} ${label}${ev.allIn ? ' (all-in)' : ''}${ev.timeout ? ' (timeout)' : ''}.`;
    }
    case 'UNCALLED_BET_RETURNED':
      return `Uncalled ${ev.amount} returned to ${name(ev.seat)}.`;
    case 'STREET_DEALT':
      return `${titleCase(ev.street)}: ${ev.cards.join(' ')}`;
    case 'CARDS_REVEALED':
      return `${name(ev.seat)} shows ${ev.cards.join(' ')} — ${ev.description}.`;
    case 'POT_AWARDED': {
      const potName = ev.potIndex === 0 ? 'the pot' : `side pot ${ev.potIndex}`;
      const winners = ev.winners.map((w) => `${name(w.seat)} (${w.amount})`).join(', ');
      const verb = ev.winners.length === 1 ? 'wins' : 'win';
      return `${winners} ${verb} ${potName} of ${ev.amount}${ev.description ? ` with ${ev.description}` : ''}.`;
    }
    case 'HAND_COMPLETED':
      return `Hand #${ev.handNo} complete.`;
    case 'HAND_VOIDED':
      return `Hand #${ev.handNo} was voided; stacks restored.`;
    case 'TABLE_CLOSED':
      return 'The table is closing: no new hands; seats are cashed out to club wallets.';
  }
}
