import { z } from 'zod';

const chips = z.number().int().positive().max(1_000_000_000_000);

export const createTableSchema = z
  .object({
    name: z.string().trim().min(3).max(64),
    maxSeats: z.number().int().min(2).max(10).default(6),
    smallBlind: chips,
    bigBlind: chips,
    buyInMin: chips,
    buyInMax: chips,
    actionTimeoutSec: z.number().int().min(5).max(120).default(20),
  })
  .strict()
  .refine((t) => t.bigBlind >= t.smallBlind, {
    path: ['bigBlind'],
    message: 'must be >= smallBlind',
  })
  .refine((t) => t.buyInMin >= t.bigBlind, { path: ['buyInMin'], message: 'must be >= bigBlind' })
  .refine((t) => t.buyInMax >= t.buyInMin, { path: ['buyInMax'], message: 'must be >= buyInMin' });
export type CreateTableInput = z.infer<typeof createTableSchema>;

export const seatSchema = z
  .object({
    seatNo: z.number().int().min(1).max(10).optional(),
    buyIn: chips,
  })
  .strict();
export type SeatInput = z.infer<typeof seatSchema>;
