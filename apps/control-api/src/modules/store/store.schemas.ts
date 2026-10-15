import { z } from 'zod';
import { cursorSchema, limitSchema, uuidSchema } from '../../common/validation/schemas';
import { PRODUCT_IDS } from './store.catalog';

export const createOrderSchema = z
  .object({
    product: z.enum(PRODUCT_IDS),
    clubId: uuidSchema.optional(),
  })
  .strict();
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const renewalSchema = z.object({ renewing: z.boolean() }).strict();
export type RenewalInput = z.infer<typeof renewalSchema>;

export const refundSchema = z.object({ reason: z.string().trim().min(3).max(200) }).strict();
export type RefundInput = z.infer<typeof refundSchema>;

export const paymentsQuerySchema = z.object({ limit: limitSchema, cursor: cursorSchema }).strict();
export type PaymentsQuery = z.infer<typeof paymentsQuerySchema>;
