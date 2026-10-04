import type { TableInfo } from './types';

/** Supported games (realtime.yaml GameType). */
export type GameType = TableInfo['gameType'];

export const GAME_TYPES: readonly GameType[] = ['NLHE', 'PLO'];

const LABELS: Record<GameType, { short: string; long: string; holeCards: number }> = {
  NLHE: { short: "NL Hold'em", long: "No-Limit Texas Hold'em", holeCards: 2 },
  PLO: { short: 'PL Omaha', long: 'Pot-Limit Omaha', holeCards: 4 },
};

/** Short display name ("NL Hold'em", "PL Omaha"). */
export function gameLabel(game: GameType | undefined): string {
  return LABELS[game ?? 'NLHE'].short;
}

/** Full display name. */
export function gameName(game: GameType | undefined): string {
  return LABELS[game ?? 'NLHE'].long;
}

/** Hole cards dealt to each player (card backs shown for opponents). */
export function holeCardCount(game: GameType | undefined): number {
  return LABELS[game ?? 'NLHE'].holeCards;
}
