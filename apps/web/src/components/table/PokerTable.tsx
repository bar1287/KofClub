import { PlayingCard } from '@/components/PlayingCard';
import { chips } from '@/lib/format';
import { seatPosition } from '@/lib/table/layout';
import type { TableState } from '@/lib/table/state';
import { SeatView } from './Seat';

interface Props {
  state: TableState;
  /** Shown on empty seats when the viewer may sit down. */
  onSit?: (seatNo: number) => void;
}

function centerMessage(state: TableState): string | null {
  const seated = Object.keys(state.seats).length;
  const hand = state.hand;
  if (hand && hand.street !== 'COMPLETE') return null;
  if (state.table?.status === 'CLOSED') return 'This table is closed.';
  if (seated < 2) return 'Waiting for players…';
  const active = Object.values(state.seats).filter((s) => !s.sittingOut && s.stack > 0).length;
  if (active < 2) return 'Waiting for players to sit in…';
  return 'Next hand starting soon…';
}

export function PokerTable({ state, onSit }: Props) {
  const maxSeats = state.table?.maxSeats ?? 6;
  const anchor = state.mySeat || 1;
  const hand = state.hand;
  const board = hand?.board ?? [];
  const message = centerMessage(state);
  const pot = hand && hand.street !== 'COMPLETE' ? hand.pot : 0;

  return (
    <div
      className="felt-wrap"
      data-testid="poker-table"
      data-seq={state.seq}
      data-hand-no={hand?.handNo ?? 0}
      data-street={hand?.street ?? ''}
    >
      <div className="felt" />
      <div className="felt-center">
        <div className="board" data-testid="board">
          {Array.from({ length: 5 }, (_, i) => (
            <PlayingCard key={board[i] ?? `empty-${i}`} card={board[i]} />
          ))}
        </div>
        <div className="pot" data-testid="pot">
          Pot {chips(pot)}
        </div>
        {message && <div className="table-message">{message}</div>}
      </div>
      {Array.from({ length: maxSeats }, (_, i) => i + 1).map((n) => {
        const pos = seatPosition(n, anchor, maxSeats);
        const seat = state.seats[n];
        if (seat) {
          return (
            <SeatView
              key={n}
              seat={seat}
              hand={hand}
              isMe={n === state.mySeat}
              myCards={state.holeCards}
              position={pos}
            />
          );
        }
        return (
          <div
            key={n}
            className="seat"
            style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            data-testid={`seat-${n}`}
          >
            {onSit ? (
              <button className="btn small" onClick={() => onSit(n)} data-testid={`sit-${n}`}>
                Sit here
              </button>
            ) : (
              <div className="seat-empty small">Seat {n}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
