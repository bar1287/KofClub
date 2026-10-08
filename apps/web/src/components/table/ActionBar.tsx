'use client';

import { useEffect, useState } from 'react';
import { chips } from '@/lib/format';
import { actionOptions, aggressiveCommand, isMyTurn, sizingPresets } from '@/lib/table/actions';
import {
  availablePreActions,
  preActionContext,
  preActionLabel,
  preActionStillValid,
  resolvePreAction,
  type PreAction,
} from '@/lib/table/preactions';
import type { TableState } from '@/lib/table/state';
import type { CommandPayload } from '@/lib/types';

interface Props {
  state: TableState;
  /** Realtime connection is open and state is trustworthy. */
  enabled: boolean;
  busy: boolean;
  send: (command: CommandPayload) => Promise<boolean>;
}

/**
 * Fold / check / call / bet / raise controls built from the server's legal
 * actions. Sizes are "to" amounts (total street commitment). While others
 * act, the viewer can queue a pre-action; it is sent as an ordinary command
 * when their turn starts (or dropped if it no longer fits).
 */
export function ActionBar({ state, enabled, busy, send }: Props) {
  const myTurn = isMyTurn(state);
  const opts = actionOptions(state.legalActions);
  const presets = sizingPresets(state);
  const agg = opts.aggressive;
  const [size, setSize] = useState<number>(agg?.minTo ?? 0);
  const [pre, setPre] = useState<PreAction | null>(null);
  const preCtx = preActionContext(state);

  // On the viewer's turn a queued pre-action is played (once); while waiting
  // it is dropped as soon as it stops applying (new street, a bet, ...).
  useEffect(() => {
    if (!pre) return;
    if (myTurn) {
      const command = resolvePreAction(pre, state);
      setPre(null);
      if (command && enabled) void send(command);
    } else if (!preActionStillValid(pre, preCtx)) {
      setPre(null);
    }
  }, [pre, myTurn, state, preCtx, enabled, send]);

  // Reset the sizing whenever a new turn starts.
  const turnSeq = state.hand?.turnSeq;
  useEffect(() => {
    if (agg) setSize(agg.minTo);
  }, [turnSeq, agg?.minTo]);

  if (!myTurn) {
    const actor = state.hand?.toActSeat ? state.seats[state.hand.toActSeat] : undefined;
    return (
      <div className="action-bar panel" data-testid="action-bar">
        <span className="muted">
          {actor && state.hand?.street !== 'COMPLETE'
            ? `Waiting for ${actor.username}…`
            : 'Waiting for the next hand…'}
        </span>
        {preCtx && (
          <div className="pre-actions" role="group" aria-label="Act in advance">
            {availablePreActions(preCtx).map((kind) => {
              const on = pre?.kind === kind;
              return (
                <label key={kind} className={`pre-action${on ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    data-testid={`pre-action-${kind}`}
                    onChange={() => setPre(on ? null : { ...preCtx, kind })}
                  />
                  {preActionLabel(kind, preCtx.toCall, chips)}
                </label>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const disabled = !enabled || busy;
  const aggressive = agg ? aggressiveCommand(opts, size) : null;

  return (
    <div className="action-bar panel" data-testid="action-bar">
      <div className="buttons">
        {opts.canFold && (
          <button
            className="btn danger"
            disabled={disabled}
            onClick={() => void send({ kind: 'FOLD' })}
          >
            Fold
          </button>
        )}
        {opts.canCheck && (
          <button className="btn" disabled={disabled} onClick={() => void send({ kind: 'CHECK' })}>
            Check
          </button>
        )}
        {opts.callAmount !== undefined && (
          <button className="btn" disabled={disabled} onClick={() => void send({ kind: 'CALL' })}>
            Call {chips(opts.callAmount)}
          </button>
        )}
        {agg && (
          <button
            className="btn primary"
            disabled={disabled || !aggressive}
            onClick={() => aggressive && void send(aggressive)}
            data-testid="aggressive-action"
          >
            {aggressive?.kind === 'ALL_IN'
              ? `All-in ${chips(agg.maxTo)}`
              : `${agg.kind === 'BET' ? 'Bet' : 'Raise to'} ${chips(size)}`}
          </button>
        )}
        {!agg && opts.allInTo !== undefined && (
          <button
            className="btn primary"
            disabled={disabled}
            onClick={() => void send({ kind: 'ALL_IN' })}
          >
            All-in
          </button>
        )}
      </div>
      {agg && agg.maxTo > agg.minTo && (
        <div className="sizing">
          {presets.map((p) => (
            <button
              key={p.label}
              className="btn small"
              disabled={disabled}
              onClick={() => setSize(p.to)}
            >
              {p.label}
            </button>
          ))}
          <input
            type="range"
            min={agg.minTo}
            max={agg.maxTo}
            step={1}
            value={size}
            aria-label="Bet size"
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <input
            type="number"
            min={agg.minTo}
            max={agg.maxTo}
            step={1}
            value={size}
            aria-label="Bet amount"
            onChange={(e) => setSize(Math.trunc(Number(e.target.value)))}
          />
        </div>
      )}
    </div>
  );
}
