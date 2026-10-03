/** Formats an integer chip amount ("12,500"). Chips are virtual (no monetary value). */
export function chips(n: number): string {
  return n.toLocaleString('en-US');
}

const SUITS: Record<string, { symbol: string; red: boolean; name: string }> = {
  s: { symbol: '♠', red: false, name: 'spades' },
  h: { symbol: '♥', red: true, name: 'hearts' },
  d: { symbol: '♦', red: true, name: 'diamonds' },
  c: { symbol: '♣', red: false, name: 'clubs' },
};

const RANK_NAMES: Record<string, string> = {
  A: 'Ace',
  K: 'King',
  Q: 'Queen',
  J: 'Jack',
  T: 'Ten',
};

/** Splits a wire card ("Td") into display parts. */
export function cardParts(card: string): {
  rank: string;
  symbol: string;
  red: boolean;
  label: string;
} {
  const rank = card.slice(0, -1);
  const suit = SUITS[card.slice(-1)] ?? { symbol: '?', red: false, name: '?' };
  return {
    rank: rank === 'T' ? '10' : rank,
    symbol: suit.symbol,
    red: suit.red,
    label: `${RANK_NAMES[rank] ?? rank} of ${suit.name}`,
  };
}
