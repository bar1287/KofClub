'use client';

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { CommandError, type ConnectionStatus } from '../realtime/client';
import { useSession } from '../session';
import type { CommandPayload, ProtocolError } from '../types';
import { initialTableState, tableReducer, type TableState } from './state';

export interface TableHandle {
  state: TableState;
  connection: ConnectionStatus;
  /** A command is awaiting its COMMAND_RESULT. */
  busy: boolean;
  /** Last rejected command / subscription error, for display. */
  error: { code: string; message: string } | null;
  clearError(): void;
  send(command: CommandPayload): Promise<boolean>;
  markLeaving(leaving: boolean): void;
}

/** Codes after which local state must not be trusted until resynced. */
const RESYNC_CODES = new Set(['STALE_GAME_STATE', 'NOT_YOUR_TURN', 'HAND_NOT_ACTIVE']);

/**
 * Subscribes to a table over the realtime connection and keeps a reducer
 * mirror of it. Resubscribes from the last applied seq whenever continuity
 * is in doubt.
 */
export function useTable(tableId: string): TableHandle {
  const { realtime, user } = useSession();
  const [state, dispatch] = useReducer(tableReducer, undefined, () =>
    initialTableState(tableId, user?.id ?? null),
  );
  const [connection, setConnection] = useState<ConnectionStatus>(realtime.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TableHandle['error']>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  const resyncPending = useRef(false);
  /** Bumped on every SUBSCRIBED so a still-stale state retries. */
  const [subscribedNonce, setSubscribedNonce] = useState(0);
  const replayAttempts = useRef(0);

  useEffect(() => realtime.onStatus(setConnection), [realtime]);

  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = realtime.subscribe(tableId, {
      lastSeq: () => (stateRef.current.ready ? stateRef.current.seq : -1),
      onSnapshot: (msg, receivedAt) => {
        resyncPending.current = false;
        replayAttempts.current = 0;
        dispatch({ type: 'snapshot', snapshot: msg.snapshot, receivedAt });
      },
      onEvent: (msg, receivedAt) => dispatch({ type: 'event', message: msg, receivedAt }),
      onSubscribed: (msg) => {
        resyncPending.current = false;
        dispatch({ type: 'live', seq: msg.seq });
        setSubscribedNonce((n) => n + 1);
      },
      onResync: () => {
        // A fresh snapshot follows; hold actions until it arrives.
        resyncPending.current = true;
        dispatch({ type: 'stale' });
      },
      onError: (err: ProtocolError) => {
        setError({ code: err.code, message: err.message });
        if (err.code === 'TABLE_UNAVAILABLE') {
          retry = setTimeout(() => realtime.resubscribe(tableId), 1_000);
        }
      },
    });
    return () => {
      if (retry) clearTimeout(retry);
      unsubscribe();
    };
  }, [realtime, tableId]);

  // A locally detected gap (or a void without start stacks) → resume with a
  // replay from the last applied seq; if that did not restore continuity,
  // fall back to a full snapshot.
  useEffect(() => {
    if (!state.stale) {
      replayAttempts.current = 0;
      return;
    }
    if (resyncPending.current) return;
    resyncPending.current = true;
    realtime.resubscribe(tableId, replayAttempts.current++ > 0);
  }, [state.stale, subscribedNonce, realtime, tableId]);

  const send = useCallback(
    async (command: CommandPayload): Promise<boolean> => {
      const current = stateRef.current;
      setBusy(true);
      setError(null);
      try {
        const res = await realtime.sendCommand(
          tableId,
          command,
          current.ready ? current.seq : undefined,
        );
        if (!res.accepted && res.error) {
          setError({ code: res.error.code, message: res.error.message });
          if (RESYNC_CODES.has(res.error.code)) dispatch({ type: 'stale' });
        }
        return res.accepted;
      } catch (err) {
        const e = err instanceof CommandError ? err : null;
        setError({ code: e?.code ?? 'INTERNAL', message: e?.message ?? 'Command failed.' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [realtime, tableId],
  );

  const markLeaving = useCallback((leaving: boolean) => dispatch({ type: 'leaving', leaving }), []);
  const clearError = useCallback(() => setError(null), []);

  return { state, connection, busy, error, clearError, send, markLeaving };
}
