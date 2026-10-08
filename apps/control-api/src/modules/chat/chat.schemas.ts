import { z } from 'zod';
import { cursorSchema, limitSchema, uuidSchema } from '../../common/validation/schemas';

/** Reactions players can send (contracts: ChatEmoji). */
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
] as const;
export type ChatEmoji = (typeof CHAT_EMOJI)[number];

/** Longest message, in characters (Unicode code points). */
export const CHAT_TEXT_MAX = 200;

// Control characters (newlines, tabs, ...) and the bidirectional overrides
// that can make a message display differently from what was sent.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/gu;

/**
 * Normalizes a chat message: unsafe characters become spaces, runs of
 * whitespace collapse to one space, and the ends are trimmed. Returns null
 * when nothing is left or the message is too long.
 */
export function cleanChatText(raw: string): string | null {
  const text = raw.replace(UNSAFE, ' ').replace(/\s+/gu, ' ').trim();
  const length = [...text].length;
  return length === 0 || length > CHAT_TEXT_MAX ? null : text;
}

/** CHAT_SEND forwarded by the realtime gateway. */
export const internalChatSchema = z
  .object({
    userId: uuidSchema,
    sessionId: uuidSchema.optional(),
    requestId: uuidSchema,
    // Bounded here; the exact rules are applied by cleanChatText.
    text: z.string().max(2000).optional(),
    emoji: z.enum(CHAT_EMOJI).optional(),
  })
  .strict()
  .refine((v) => (v.text === undefined) !== (v.emoji === undefined), {
    message: 'exactly one of text or emoji',
  });
export type InternalChatInput = z.infer<typeof internalChatSchema>;

export const reportChatSchema = z
  .object({
    messageId: uuidSchema,
    reason: z.string().trim().max(200).optional(),
  })
  .strict();
export type ReportChatInput = z.infer<typeof reportChatSchema>;

export const chatReportStatusSchema = z.enum(['OPEN', 'DISMISSED', 'HIDDEN']);
export type ChatReportStatus = z.infer<typeof chatReportStatusSchema>;

export const listChatReportsQuerySchema = z.object({
  status: chatReportStatusSchema.optional(),
  limit: limitSchema,
  cursor: cursorSchema,
});
export type ListChatReportsQuery = z.infer<typeof listChatReportsQuerySchema>;

export const resolveChatReportSchema = z.object({ action: z.enum(['DISMISS', 'HIDE']) }).strict();
export type ResolveChatReportInput = z.infer<typeof resolveChatReportSchema>;
