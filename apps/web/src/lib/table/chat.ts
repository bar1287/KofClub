import type { ChatEmoji, ChatFrame, ChatHistory, ChatMessage } from '../types';

/** Reactions offered at the table (contracts: ChatEmoji). */
export const CHAT_EMOJI = [
  '👍',
  '👏',
  '😂',
  '😮',
  '😢',
  '😡',
  '🔥',
  '🎉',
  '🤝',
  '😎',
  '🙏',
  '💪',
] as const satisfies readonly ChatEmoji[];
// Every contract emoji is offered.
type Missing = Exclude<ChatEmoji, (typeof CHAT_EMOJI)[number]>;
const allOffered: Missing extends never ? true : false = true;
void allOffered;

export const CHAT_TEXT_MAX = 200;
/** Messages kept in view (older ones scroll away). */
export const CHAT_KEEP = 100;
/** How long a reaction stays above a seat. */
export const REACTION_MS = 3_000;

export interface Reaction {
  id: string;
  userId: string;
  emoji: ChatEmoji;
  /** Local receive time (ms). */
  at: number;
}

export interface ChatState {
  loaded: boolean;
  enabled: boolean;
  canSend: boolean;
  messages: ChatMessage[];
  reactions: Reaction[];
}

export const initialChatState: ChatState = {
  loaded: false,
  enabled: true,
  canSend: false,
  messages: [],
  reactions: [],
};

export type ChatAction =
  | { type: 'history'; history: ChatHistory }
  | { type: 'frame'; frame: ChatFrame; at: number }
  | { type: 'disabled' }
  | { type: 'expire'; now: number };

function byTime(a: ChatMessage, b: ChatMessage): number {
  return a.sentAt === b.sentAt ? (a.id < b.id ? -1 : 1) : a.sentAt < b.sentAt ? -1 : 1;
}

/** Merges messages by id (history after a reconnect overlaps live ones). */
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) seen.set(m.id, m);
  return [...seen.values()].sort(byTime).slice(-CHAT_KEEP);
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'history': {
      const { enabled, canSend, items } = action.history;
      return {
        ...state,
        loaded: true,
        enabled,
        canSend,
        messages: enabled ? merge(state.messages, items) : [],
      };
    }
    case 'frame': {
      const f = action.frame;
      if (f.type === 'CHAT_HIDDEN') {
        return { ...state, messages: state.messages.filter((m) => m.id !== f.messageId) };
      }
      const m = f.message;
      if (m.kind === 'REACTION') {
        if (!m.emoji) return state;
        const reaction = { id: m.id, userId: m.userId, emoji: m.emoji, at: action.at };
        return { ...state, reactions: [...state.reactions, reaction] };
      }
      if (state.messages.some((x) => x.id === m.id)) return state;
      return { ...state, messages: [...state.messages, m].slice(-CHAT_KEEP) };
    }
    case 'disabled':
      return { ...state, enabled: false, canSend: false, messages: [], reactions: [] };
    case 'expire': {
      const reactions = state.reactions.filter((r) => action.now - r.at < REACTION_MS);
      return reactions.length === state.reactions.length ? state : { ...state, reactions };
    }
  }
}

/** The latest live reaction per player (one bubble per seat). */
export function seatReactions(
  reactions: Reaction[],
  muted: Readonly<Record<string, string>>,
): Record<string, ChatEmoji> {
  const out: Record<string, ChatEmoji> = {};
  for (const r of reactions) if (!muted[r.userId]) out[r.userId] = r.emoji;
  return out;
}

// --- per-viewer mute list (browser storage; never sent to the server) ------

const mutedKey = (viewerId: string) => `kofclub.chat.muted.${viewerId}`;

/** Muted players (userId → username) of a viewer; empty when unavailable. */
export function loadMuted(viewerId: string | null | undefined): Record<string, string> {
  if (!viewerId) return {};
  try {
    const raw = window.localStorage.getItem(mutedKey(viewerId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === 'string'),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveMuted(
  viewerId: string | null | undefined,
  muted: Record<string, string>,
): void {
  if (!viewerId) return;
  try {
    window.localStorage.setItem(mutedKey(viewerId), JSON.stringify(muted));
  } catch {
    /* storage unavailable: muting lasts for this page only */
  }
}

/** Friendly text for a rejected chat send. */
export function chatErrorText(code: string, message: string): string {
  switch (code) {
    case 'RATE_LIMITED':
      return 'Slow down: you are sending messages too quickly.';
    case 'CHAT_DISABLED':
      return 'Chat is turned off in this club.';
    case 'CONNECTION_CLOSED':
      return 'Not connected; the message was not sent.';
    case 'VALIDATION_FAILED':
      return 'Messages have 1 to 200 characters.';
    default:
      return message;
  }
}
