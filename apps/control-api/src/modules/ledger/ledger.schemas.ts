import { z } from 'zod';
import { MAX_CHIP_AMOUNT } from './ledger.repository';

/** Positive integer chip amount for administrative operations. */
export const chipAmountSchema = z.number().int().positive().max(MAX_CHIP_AMOUNT);

export const chipMovementSchema = z
  .object({
    userId: z.string().uuid(),
    amount: chipAmountSchema,
    note: z.string().trim().max(200).optional(),
  })
  .strict();
export type ChipMovementInput = z.infer<typeof chipMovementSchema>;

export const reversalSchema = z.object({ note: z.string().trim().min(1).max(200) }).strict();
export type ReversalInput = z.infer<typeof reversalSchema>;

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;
