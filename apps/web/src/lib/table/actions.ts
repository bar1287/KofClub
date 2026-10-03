import type { CommandPayload, LegalAction } from '../types';
import type { TableState } from './state';

/**
 * Presentation helpers for the action bar. They only shape *intent*: the
 * server validates every command against its own legal-action set.
 */
export interface ActionOptions {
  canFold: boolean;
  canCheck: boolean;
  /** Chips to add to call (undefined when calling is not legal). */
  callAmount?: number;
  /** BET or RAISE when aggression is legal. */
  aggressive?: { kind: 'BET' | 'RAISE'; minTo: number; maxTo: number };
  /** Resulting street commitment of an all-in. */
  allInTo?: number;
}

export function actionOptions(legal: LegalAction[]): ActionOptions {
  const opts: ActionOptions = { canFold: false, canCheck: false };
  for (const a of legal) {
    switch (a.kind) {
      case 'FOLD':
        opts.canFold = true;
        break;
      case 'CHECK':
        opts.canCheck = true;
        break;
      case 'CALL':
        opts.callAmount = a.amount ?? 0;
        break;
      case 'BET':
      case 'RAISE':
        opts.aggressive = { kind: a.kind, minTo: a.minTo ?? 0, maxTo: a.maxTo ?? 0 };
        break;
      case 'ALL_IN':
        opts.allInTo = a.amount;
        break;
    }
  }
  return opts;
}

export interface SizingPreset {
  label: string;
  to: number;
}

/**
 * Bet-size presets ("to" amounts) clamped to the legal range: minimum,
 * half pot, pot and all-in. A pot-sized raise is the current bet plus the
 * pot after calling.
 */
export function sizingPresets(state: TableState): SizingPreset[] {
  const opts = actionOptions(state.legalActions);
  const agg = opts.aggressive;
  const hand = state.hand;
  const me = state.seats[state.mySeat];
  if (!agg || !hand || !me) return [];
  const toCall = Math.max(0, hand.currentBet - me.streetBet);
  const potAfterCall = hand.pot + toCall;
  const clamp = (v: number) => Math.min(agg.maxTo, Math.max(agg.minTo, Math.floor(v)));
  const candidates: SizingPreset[] = [
    { label: 'Min', to: agg.minTo },
    { label: '½ Pot', to: clamp(hand.currentBet + potAfterCall / 2) },
    { label: 'Pot', to: clamp(hand.currentBet + potAfterCall) },
    { label: 'All-in', to: agg.maxTo },
  ];
  const seen = new Set<number>();
  return candidates.filter((p) => {
    if (seen.has(p.to)) return false;
    seen.add(p.to);
    return true;
  });
}

/**
 * The command for a chosen bet size: moving all chips in is sent as
 * ALL_IN when that is legal, otherwise BET/RAISE with the "to" amount.
 */
export function aggressiveCommand(opts: ActionOptions, to: number): CommandPayload | null {
  const agg = opts.aggressive;
  if (!agg || !Number.isSafeInteger(to)) return null;
  if (to >= agg.maxTo && opts.allInTo !== undefined) return { kind: 'ALL_IN' };
  if (to < agg.minTo || to > agg.maxTo) return null;
  return { kind: agg.kind, amount: to };
}

/** Whether the viewer may act now. */
export function isMyTurn(state: TableState): boolean {
  return (
    state.ready &&
    !state.stale &&
    state.mySeat !== 0 &&
    state.hand?.toActSeat === state.mySeat &&
    state.legalActions.length > 0
  );
}
