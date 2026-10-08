import type { ChatHistory, ChatMessage } from '../types';
import {
  CHAT_KEEP,
  chatErrorText,
  chatReducer,
  initialChatState,
  loadMuted,
  REACTION_MS,
  saveMuted,
  seatReactions,
  type ChatState,
} from './chat';

const TABLE = '0191a000-0000-7000-8000-000000000001';

function msg(n: number, userId = 'u1', patch: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m-${String(n).padStart(4, '0')}`,
    tableId: TABLE,
    kind: 'MESSAGE',
    userId,
    username: userId,
    text: `hello ${n}`,
    sentAt: new Date(Date.UTC(2026, 9, 8, 12, 0, n)).toISOString(),
    ...patch,
  };
}

function history(items: ChatMessage[], patch: Partial<ChatHistory> = {}) {
  const h: ChatHistory = { tableId: TABLE, enabled: true, canSend: true, items, ...patch };
  return { type: 'history', history: h } as const;
}

const live = (m: ChatMessage, at = 0) =>
  ({ type: 'frame', frame: { type: 'CHAT_MESSAGE', tableId: TABLE, message: m }, at }) as const;

describe('chatReducer', () => {
  it('merges history with live messages by id, in time order', () => {
    let s = chatReducer(initialChatState, live(msg(3)));
    s = chatReducer(s, history([msg(1), msg(2), msg(3)]));
    expect(s.loaded).toBe(true);
    expect(s.messages.map((m) => m.id)).toEqual(['m-0001', 'm-0002', 'm-0003']);
    // The same message delivered again (e.g. after a reconnect) is kept once.
    s = chatReducer(s, live(msg(3)));
    expect(s.messages).toHaveLength(3);
  });

  it('keeps the latest messages only', () => {
    let s: ChatState = initialChatState;
    for (let i = 0; i < CHAT_KEEP + 5; i++) s = chatReducer(s, live(msg(i)));
    expect(s.messages).toHaveLength(CHAT_KEEP);
    expect(s.messages[0]!.id).toBe('m-0005');
  });

  it('removes hidden messages and clears everything when chat is off', () => {
    let s = chatReducer(initialChatState, history([msg(1), msg(2)]));
    s = chatReducer(s, {
      type: 'frame',
      frame: { type: 'CHAT_HIDDEN', tableId: TABLE, messageId: 'm-0001' },
      at: 0,
    });
    expect(s.messages.map((m) => m.id)).toEqual(['m-0002']);
    s = chatReducer(s, { type: 'disabled' });
    expect(s).toMatchObject({ enabled: false, canSend: false, messages: [] });
    s = chatReducer(s, history([msg(5)], { enabled: false, canSend: false }));
    expect(s.messages).toEqual([]);
  });

  it('shows reactions for a few seconds, one per player', () => {
    const reaction = (userId: string, emoji: '🔥' | '👍', at: number) =>
      live(msg(at, userId, { kind: 'REACTION', emoji, text: undefined, id: `r-${at}` }), at);
    let s = chatReducer(initialChatState, reaction('u1', '🔥', 1_000));
    s = chatReducer(s, reaction('u1', '👍', 1_500));
    s = chatReducer(s, reaction('u2', '🔥', 2_000));
    expect(s.messages).toEqual([]);
    expect(seatReactions(s.reactions, {})).toEqual({ u1: '👍', u2: '🔥' });
    expect(seatReactions(s.reactions, { u2: 'u2' })).toEqual({ u1: '👍' });

    s = chatReducer(s, { type: 'expire', now: 1_500 + REACTION_MS });
    expect(seatReactions(s.reactions, {})).toEqual({ u2: '🔥' });
    const same = chatReducer(s, { type: 'expire', now: 1_500 + REACTION_MS });
    expect(same).toBe(s);
  });
});

describe('mute list', () => {
  const store = new Map<string, string>();
  beforeAll(() => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
  });
  afterAll(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('is kept per viewer and survives bad stored data', () => {
    saveMuted('viewer-1', { u2: 'bob' });
    expect(loadMuted('viewer-1')).toEqual({ u2: 'bob' });
    expect(loadMuted('viewer-2')).toEqual({});
    expect(loadMuted(null)).toEqual({});
    store.set('kofclub.chat.muted.viewer-3', '{not json');
    expect(loadMuted('viewer-3')).toEqual({});
    store.set('kofclub.chat.muted.viewer-4', JSON.stringify({ a: 'x', b: 7 }));
    expect(loadMuted('viewer-4')).toEqual({ a: 'x' });
  });
});

describe('chatErrorText', () => {
  it('explains common rejections', () => {
    expect(chatErrorText('RATE_LIMITED', 'x')).toMatch(/too quickly/);
    expect(chatErrorText('CHAT_DISABLED', 'x')).toMatch(/turned off/);
    expect(chatErrorText('NOT_CLUB_MEMBER', 'You are not a member')).toBe('You are not a member');
  });
});
