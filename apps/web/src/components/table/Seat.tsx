import type { ReactNode } from 'react';
import { PlayingCard } from '@/components/PlayingCard';
import { chips } from '@/lib/format';
import type { HandState, SeatState } from '@/lib/table/state';
import type { Card } from '@/lib/types';
import { TurnTimer } from './TurnTimer';

interface Props {
  seat: SeatState;
  hand: HandState | null;
  isMe: boolean;
  myCards: Card[];
  /** Hole cards per player in this game (card backs for opponents). */
  holeCards: number;
  position: { left: number; top: number };
}

function statusLine(seat: SeatState, hand: HandState | null): string {
  if (seat.leaving) return 'Leaving';
  if (seat.sittingOut) return 'Sitting out';
  if (seat.allIn && hand && hand.street !== 'COMPLETE') return 'All-in';
  if (seat.folded) return 'Folded';
  if (seat.lastAction) return seat.lastAction.toLowerCase().replace('_', '-');
  return '';
}

export function SeatView({ seat, hand, isMe, myCards, holeCards, position }: Props) {
  const acting = hand?.toActSeat === seat.seat;
  const handLive = hand !== null && hand.street !== 'COMPLETE';
  const won = hand?.awards
    .flatMap((a) => a.winners)
    .filter((w) => w.seat === seat.seat)
    .reduce((sum, w) => sum + w.amount, 0);

  let cards: ReactNode = null;
  if (seat.shownCards && seat.shownCards.length > 0) {
    cards = seat.shownCards.map((c) => <PlayingCard key={c} card={c} small />);
  } else if (isMe && myCards.length > 0 && seat.inHand) {
    cards = myCards.map((c) => <PlayingCard key={c} card={c} small />);
  } else if (seat.inHand && !seat.folded && handLive) {
    cards = Array.from({ length: holeCards }, (_, i) => <PlayingCard key={i} back small />);
  }

  const classes = ['seat'];
  if (acting) classes.push('acting');
  if (isMe) classes.push('me');
  if (seat.folded && handLive) classes.push('folded');
  if (seat.sittingOut) classes.push('sitting-out');

  return (
    <div
      className={classes.join(' ')}
      style={{ left: `${position.left}%`, top: `${position.top}%` }}
      data-testid={`seat-${seat.seat}`}
      data-username={seat.username}
      data-acting={acting ? 'true' : 'false'}
    >
      <div className="seat-cards" data-testid={isMe ? 'my-cards' : undefined}>
        {cards}
      </div>
      <div className="seat-box">
        {hand && hand.buttonSeat === seat.seat && <span className="marker dealer">D</span>}
        {hand && handLive && hand.smallBlindSeat === seat.seat && hand.buttonSeat !== seat.seat && (
          <span className="marker sb">SB</span>
        )}
        {hand && handLive && hand.bigBlindSeat === seat.seat && (
          <span className="marker bb">BB</span>
        )}
        <div className="seat-name">{seat.username}</div>
        <div className="seat-stack" data-testid="seat-stack">
          {chips(seat.stack)}
        </div>
        <div className="seat-status">
          {won ? (
            <span style={{ color: '#f0d36b' }}>Wins {chips(won)}</span>
          ) : (
            statusLine(seat, hand)
          )}
        </div>
        {seat.shownDescription && <div className="small muted">{seat.shownDescription}</div>}
        {acting && hand?.deadlineAt && (
          <TurnTimer deadlineAt={hand.deadlineAt} totalMs={hand.turnTimeoutMs} />
        )}
      </div>
      {seat.streetBet > 0 && handLive && (
        <div className="seat-bet" data-testid="seat-bet">
          {chips(seat.streetBet)}
        </div>
      )}
    </div>
  );
}
