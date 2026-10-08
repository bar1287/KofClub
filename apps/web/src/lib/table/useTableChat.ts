'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { errorMessage } from '../api/client';
import { CommandError, type ConnectionStatus } from '../realtime/client';
import { useSession } from '../session';
import type { ChatEmoji, ChatMessage } from '../types';
import {
  chatErrorText,
  chatReducer,
  initialChatState,
  loadMuted,
  saveMuted,
  seatReactions,
} from './chat';

export interface TableChatHandle {
  loaded: boolean;
  enabled: boolean;
  canSend: boolean;
  /** Messages from players the viewer has not muted, oldest first. */
  messages: ChatMessage[];
  /** Current reaction per player (userId → emoji), for seat bubbles. */
  reactions: Record<string, ChatEmoji>;
  muted: Record<string, string>;
  error: string | null;
  clearError(): void;
  say(text: string): Promise<boolean>;
  react(emoji: ChatEmoji): void;
  mute(userId: string, username: string): void;
  unmuteAll(): void;
  report(messageId: string, reason?: string): Promise<void>;
}

/**
 * Table chat: recent history over HTTP (refetched whenever the realtime
 * connection opens, so nothing sent while offline is missed), live
 * messages and reactions over the realtime connection, and a per-viewer
 * mute list kept in this browser.
 */
export function useTableChat(tableId: string, connection: ConnectionStatus): TableChatHandle {
  const { realtime, ep, user } = useSession();
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [muted, setMuted] = useState<Record<string, string>>(() => loadMuted(user?.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => realtime.onChat(tableId, (frame) => dispatch({ type: 'frame', frame, at: Date.now() })),
    [realtime, tableId],
  );

  useEffect(() => {
    if (connection !== 'open') return;
    let cancelled = false;
    ep.tableChat(tableId)
      .then((history) => {
        if (!cancelled) dispatch({ type: 'history', history });
      })
      .catch(() => undefined); // chat is optional; the table still works
    return () => {
      cancelled = true;
    };
  }, [ep, tableId, connection]);

  const hasReactions = state.reactions.length > 0;
  useEffect(() => {
    if (!hasReactions) return;
    const timer = setInterval(() => dispatch({ type: 'expire', now: Date.now() }), 250);
    return () => clearInterval(timer);
  }, [hasReactions]);

  const fail = useCallback((err: unknown) => {
    if (err instanceof CommandError) {
      if (err.code === 'CHAT_DISABLED') dispatch({ type: 'disabled' });
      setError(chatErrorText(err.code, err.message));
    } else {
      setError(errorMessage(err));
    }
  }, []);

  const say = useCallback(
    async (text: string): Promise<boolean> => {
      setError(null);
      try {
        await realtime.sendChat(tableId, { text });
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    },
    [realtime, tableId, fail],
  );

  const react = useCallback(
    (emoji: ChatEmoji) => {
      setError(null);
      realtime.sendChat(tableId, { emoji }).catch(fail);
    },
    [realtime, tableId, fail],
  );

  const mute = useCallback(
    (userId: string, username: string) => {
      setMuted((current) => {
        const next = { ...current, [userId]: username };
        saveMuted(user?.id, next);
        return next;
      });
    },
    [user?.id],
  );
  const unmuteAll = useCallback(() => {
    saveMuted(user?.id, {});
    setMuted({});
  }, [user?.id]);

  const report = useCallback(
    async (messageId: string, reason?: string) => {
      await ep.reportChat(tableId, messageId, reason);
    },
    [ep, tableId],
  );

  const messages = useMemo(
    () => state.messages.filter((m) => !muted[m.userId]),
    [state.messages, muted],
  );
  const reactions = useMemo(() => seatReactions(state.reactions, muted), [state.reactions, muted]);
  const clearError = useCallback(() => setError(null), []);

  return {
    loaded: state.loaded,
    enabled: state.enabled,
    canSend: state.canSend,
    messages,
    reactions,
    muted,
    error,
    clearError,
    say,
    react,
    mute,
    unmuteAll,
    report,
  };
}
