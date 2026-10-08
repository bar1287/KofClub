import type { CommandPayload, Street } from '../types';
import { actionOptions, isMyTurn } from './actions';
import type { TableState } from './state';

/**
 * Pre-actions: a choice made before the viewer's turn, sent as an ordinary
 * command when the turn arrives (the server validates it like any other).
 * Nothing is sent early; a pre-action is a local intention only.
 */
export type PreActionKind = 'CHECK_FOLD' | 'CHECK' | 'CALL' | 'CALL_ANY' | 'FOLD';

/** The viewer's position while waiting for their turn. */
export interface PreActionContext {
  handNo: number;
  street: Street;
  /** Chips the viewer would add to call now (capped at their stack). */
  toCall: number;
}

/** A chosen pre-action and the situation it was chosen in. */
export interface PreAction extends PreActionContext {
  kind: PreActionKind;
}

/**
 * Where the viewer stands while someone else acts, or null when no
 * pre-action applies (not seated, not in the hand, folded, all-in, their own
 * turn, or no hand running).
 */
export function preActionContext(state: TableState): PreActionContext | null {
  const hand = state.hand;
  const me = state.seats[state.mySeat];
  if (!state.ready || state.stale || !hand || !me || hand.street === 'COMPLETE') return null;
  if (isMyTurn(state) || !me.inHand || me.folded || me.allIn) return null;
  return {
    handNo: hand.handNo,
    street: hand.street,
    toCall: Math.min(Math.max(0, hand.currentBet - me.streetBet), me.stack),
  };
}

/** The pre-actions offered in a situation, in display order. */
export function availablePreActions(ctx: PreActionContext): PreActionKind[] {
  return ctx.toCall === 0 ? ['CHECK_FOLD', 'CHECK', 'CALL_ANY'] : ['FOLD', 'CALL', 'CALL_ANY'];
}

/**
 * Whether a pre-action still applies. Every pre-action ends with its street
 * (and hand); "Check" ends when a bet is made and "Call" when the amount to
 * call changes.
 */
export function preActionStillValid(pre: PreAction, ctx: PreActionContext | null): boolean {
  if (!ctx || ctx.handNo !== pre.handNo || ctx.street !== pre.street) return false;
  switch (pre.kind) {
    case 'CHECK':
      return ctx.toCall === 0;
    case 'CALL':
      return ctx.toCall === pre.toCall;
    default:
      return true;
  }
}

/**
 * The command a pre-action becomes on the viewer's turn, or null when it no
 * longer fits the legal actions (the player then decides by hand).
 */
export function resolvePreAction(pre: PreAction, state: TableState): CommandPayload | null {
  const hand = state.hand;
  if (!isMyTurn(state) || !hand || hand.handNo !== pre.handNo || hand.street !== pre.street) {
    return null;
  }
  const opts = actionOptions(state.legalActions);
  switch (pre.kind) {
    case 'CHECK_FOLD':
      if (opts.canCheck) return { kind: 'CHECK' };
      return opts.canFold ? { kind: 'FOLD' } : null;
    case 'CHECK':
      return opts.canCheck ? { kind: 'CHECK' } : null;
    case 'CALL':
      return opts.callAmount === pre.toCall ? { kind: 'CALL' } : null;
    case 'CALL_ANY':
      if (opts.callAmount !== undefined) return { kind: 'CALL' };
      return opts.canCheck ? { kind: 'CHECK' } : null;
    case 'FOLD':
      return opts.canFold ? { kind: 'FOLD' } : null;
  }
}

/** Button label for a pre-action. */
export function preActionLabel(kind: PreActionKind, toCall: number, format: (n: number) => string) {
  switch (kind) {
    case 'CHECK_FOLD':
      return 'Check/Fold';
    case 'CHECK':
      return 'Check';
    case 'CALL':
      return `Call ${format(toCall)}`;
    case 'CALL_ANY':
      return 'Call any';
    case 'FOLD':
      return 'Fold';
  }
}
