/**
 * TypeScript copy of the tournament blind schedule and payout table
 * (go/tournament) used for display: the level list, the current level and
 * projected payouts. The game service is authoritative for blinds in play
 * and for the prizes actually paid; structure.spec.ts checks this file
 * against go/tournament/testdata/golden.json so the copies cannot drift.
 */

export const MAX_BLIND = 1_000_000_000_000;

// Level-1 multipliers in halves: x1, x1.5, x2, x3, ... x200; then doubling.
const MULTIPLIERS = [
  2, 3, 4, 6, 8, 10, 12, 16, 20, 30, 40, 50, 60, 80, 100, 120, 160, 200, 300, 400,
];

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
}

export interface Structure {
  smallBlind: number;
  bigBlind: number;
  levelDurationSec: number;
}

function capBlind(base: number, num: number, den: number): number {
  if (base > Math.floor(MAX_BLIND / num)) return MAX_BLIND;
  return Math.min(Math.floor((base * num) / den), MAX_BLIND);
}

/** Level n (1-based) of a structure. */
export function blindLevel(s: Structure, n: number): BlindLevel {
  const level = Math.max(1, n);
  const k = level - 1;
  if (k < MULTIPLIERS.length) {
    const m = MULTIPLIERS[k]!;
    return {
      level,
      smallBlind: capBlind(s.smallBlind, m, 2),
      bigBlind: capBlind(s.bigBlind, m, 2),
    };
  }
  const last = MULTIPLIERS[MULTIPLIERS.length - 1]!;
  let sb = capBlind(s.smallBlind, last, 2);
  let bb = capBlind(s.bigBlind, last, 2);
  for (let i = MULTIPLIERS.length; i <= k && bb < MAX_BLIND; i++) {
    sb = Math.min(sb * 2, MAX_BLIND);
    bb = Math.min(bb * 2, MAX_BLIND);
  }
  return { level, smallBlind: sb, bigBlind: bb };
}

export function blindLevels(s: Structure, count: number): BlindLevel[] {
  return Array.from({ length: count }, (_, i) => blindLevel(s, i + 1));
}

/** The level in effect after elapsedMs of play and when it ends. */
export function levelAt(s: Structure, elapsedMs: number): { level: BlindLevel; endsInMs: number } {
  const durationMs = s.levelDurationSec * 1000;
  const elapsed = Math.max(0, elapsedMs);
  const idx = Math.floor(elapsed / durationMs);
  return { level: blindLevel(s, idx + 1), endsInMs: (idx + 1) * durationMs - elapsed };
}

const PAYOUT_TABLE: Array<{ maxEntrants: number; shares: number[] }> = [
  { maxEntrants: 3, shares: [10000] },
  { maxEntrants: 6, shares: [6500, 3500] },
  { maxEntrants: 10, shares: [5000, 3000, 2000] },
  { maxEntrants: 20, shares: [4000, 2500, 1600, 1100, 800] },
  { maxEntrants: 35, shares: [3200, 2000, 1400, 1000, 800, 650, 550, 400] },
  {
    maxEntrants: Number.MAX_SAFE_INTEGER,
    shares: [2700, 1700, 1200, 900, 750, 600, 500, 400, 350, 300, 300, 300],
  },
];

/** Prize shares in basis points for a field size. */
export function payoutShares(entrants: number): number[] {
  const row = PAYOUT_TABLE.find((r) => entrants <= r.maxEntrants)!;
  const out = row.shares.slice(0, Math.min(row.shares.length, Math.max(entrants, 1)));
  out[0]! += 10000 - out.reduce((a, b) => a + b, 0);
  return out;
}

/** Prizes by place: floor of each share, remainder to first place. */
export function prizes(entrants: number, pool: number): number[] {
  const shares = payoutShares(entrants);
  const out = shares.map((s) => Number((BigInt(pool) * BigInt(s)) / 10000n));
  out[0]! += pool - out.reduce((a, b) => a + b, 0);
  return out;
}

/** Tables a tournament needs at most (created with it). */
export function tableCount(maxPlayers: number, seatsPerTable: number): number {
  return Math.ceil(maxPlayers / seatsPerTable);
}
