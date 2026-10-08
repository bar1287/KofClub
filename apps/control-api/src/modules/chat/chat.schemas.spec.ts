import { CHAT_TEXT_MAX, cleanChatText, internalChatSchema } from './chat.schemas';

describe('cleanChatText', () => {
  it('collapses whitespace and removes control and direction-override characters', () => {
    expect(cleanChatText('  well\n\nplayed\t ')).toBe('well played');
    expect(cleanChatText('abc‮def⁦x\u0007y')).toBe('abc def x y');
  });

  it('keeps emoji, including joined sequences, and counts them once', () => {
    const family = '👨‍👩‍👧';
    expect(cleanChatText(`nice ${family}`)).toBe(`nice ${family}`);
    expect(cleanChatText('🙂'.repeat(CHAT_TEXT_MAX))).not.toBeNull();
    expect(cleanChatText('🙂'.repeat(CHAT_TEXT_MAX + 1))).toBeNull();
  });

  it('rejects empty messages', () => {
    expect(cleanChatText('')).toBeNull();
    expect(cleanChatText(' \n‎\t')).not.toBeNull(); // a format character is visible content
    expect(cleanChatText(' \n\r\t ')).toBeNull();
  });
});

describe('internalChatSchema', () => {
  const base = {
    userId: '0191f2a0-0000-7000-8000-000000000001',
    requestId: '0191f2a0-0000-7000-8000-000000000002',
  };

  it('needs exactly one of text and emoji, and an allowed emoji', () => {
    expect(internalChatSchema.safeParse({ ...base, text: 'hi' }).success).toBe(true);
    expect(internalChatSchema.safeParse({ ...base, emoji: '🔥' }).success).toBe(true);
    expect(internalChatSchema.safeParse({ ...base, emoji: '💩' }).success).toBe(false);
    expect(internalChatSchema.safeParse({ ...base, text: 'hi', emoji: '🔥' }).success).toBe(false);
    expect(internalChatSchema.safeParse(base).success).toBe(false);
  });
});
