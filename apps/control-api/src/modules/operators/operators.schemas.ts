import { z } from 'zod';
import { cursorSchema, limitSchema } from '../../common/validation/schemas';

export const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/, 'invalid slug');
const botTokenSchema = z
  .string()
  .trim()
  .regex(/^\d{5,}:[A-Za-z0-9_-]{30,}$/, 'must look like 123456:ABC… (from @BotFather)');

export const registerOperatorSchema = z
  .object({
    name: z.string().trim().min(2).max(48),
    slug: slugSchema,
    botToken: botTokenSchema,
    acceptTerms: z.literal(true),
  })
  .strict();
export type RegisterOperatorInput = z.infer<typeof registerOperatorSchema>;

export const botTokenBodySchema = z.object({ botToken: botTokenSchema }).strict();
export type BotTokenInput = z.infer<typeof botTokenBodySchema>;

export const operatorsQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED']).optional(),
    limit: limitSchema,
    cursor: cursorSchema,
  })
  .strict();
export type OperatorsQuery = z.infer<typeof operatorsQuerySchema>;

export const setStatusSchema = z
  .object({
    status: z.enum(['ACTIVE', 'SUSPENDED', 'REJECTED']),
    reason: z.string().trim().min(3).max(200),
  })
  .strict();
export type SetStatusInput = z.infer<typeof setStatusSchema>;
