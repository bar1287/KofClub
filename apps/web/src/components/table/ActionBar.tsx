'use client';

import { useEffect, useState } from 'react';
import { chips } from '@/lib/format';
import { actionOptions, aggressiveCommand, isMyTurn, sizingPresets } from '@/lib/table/actions';
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
 * actions. Sizes are "to" amounts (total street commitment).
 */
export function ActionBar({ state, enabled, busy, send }: Props) {
  const myTurn = isMyTurn(state);
  const opts = actionOptions(state.legalActions);
  const presets = sizingPresets(state);
  const agg = opts.aggressive;
  const [size, setSize] = useState<number>(agg?.minTo ?? 0);

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
