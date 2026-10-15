import { z } from 'zod';

/**
 * Telegram Stars payment updates (Bot API), validated before use. Unknown
 * fields are ignored: Telegram adds fields over time.
 */
export const preCheckoutQuerySchema = z.object({
  id: z.string().min(1).max(256),
  from: z.object({ id: z.number().int().positive() }).passthrough(),
  currency: z.string(),
  total_amount: z.number().int(),
  invoice_payload: z.string().max(128),
});
export type PreCheckoutQuery = z.infer<typeof preCheckoutQuerySchema>;

export const successfulPaymentSchema = z.object({
  currency: z.string(),
  total_amount: z.number().int().positive(),
  invoice_payload: z.string().max(128),
  telegram_payment_charge_id: z.string().min(1).max(256),
  /** Unix time when the paid subscription period ends. */
  subscription_expiration_date: z.number().int().positive().optional(),
  is_recurring: z.boolean().optional(),
  is_first_recurring: z.boolean().optional(),
});
export type SuccessfulPayment = z.infer<typeof successfulPaymentSchema>;

export const refundedPaymentSchema = z.object({
  currency: z.string(),
  total_amount: z.number().int(),
  invoice_payload: z.string().max(128),
  telegram_payment_charge_id: z.string().min(1).max(256),
});
export type RefundedPayment = z.infer<typeof refundedPaymentSchema>;

/** A renewal Telegram charged on its own (not the first payment). */
export function isRenewal(p: SuccessfulPayment): boolean {
  return p.is_recurring === true && p.is_first_recurring !== true;
}

/** Telegram's answer when a charge was already refunded. */
export function alreadyRefunded(description: string): boolean {
  return /CHARGE_ALREADY_REFUNDED/i.test(description);
}
