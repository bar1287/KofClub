'use client';

import { cardParts } from '@/lib/format';
import type { CommandPayload } from '@/lib/types';

interface Props {
  /** The viewer's cards not shown yet from the hand that just ended. */
  cards: string[];
  enabled: boolean;
  send: (command: CommandPayload) => Promise<boolean>;
}

/**
 * After a hand (until the next one starts) a player may show some or all
 * of their cards, e.g. after winning without a showdown or folding.
 */
export function ShowCards({ cards, enabled, send }: Props) {
  if (cards.length === 0) return null;
  return (
    <div className="row show-cards" data-testid="show-cards">
      <span className="muted small">Show your cards:</span>
      {cards.map((c) => {
        const p = cardParts(c);
        return (
          <button
            key={c}
            className={`btn small${p.red ? ' red-card' : ''}`}
            disabled={!enabled}
            onClick={() => void send({ kind: 'SHOW_CARDS', cards: [c] })}
            aria-label={`Show ${p.label}`}
            data-testid={`show-${c}`}
          >
            {p.rank}
            {p.symbol}
          </button>
        );
      })}
      {cards.length > 1 && (
        <button
          className="btn small"
          disabled={!enabled}
          onClick={() => void send({ kind: 'SHOW_CARDS', cards })}
          data-testid="show-all"
        >
          Show all
        </button>
      )}
    </div>
  );
}
