import { z } from 'zod';

const chips = z.number().int().positive().max(1_000_000_000_000);

/** Supported games (realtime.yaml GameType); fixed for a table's lifetime. */
export const GAME_TYPES = ['NLHE', 'PLO'] as const;
export type GameType = (typeof GAME_TYPES)[number];

export const createTableSchema = z
  .object({
    name: z.string().trim().min(3).max(64),
    gameType: z.enum(GAME_TYPES).default('NLHE'),
    maxSeats: z.number().int().min(2).max(10).default(6),
    smallBlind: chips,
    bigBlind: chips,
    buyInMin: chips,
    buyInMax: chips,
    actionTimeoutSec: z.number().int().min(5).max(120).default(20),
    timeBankSec: z.number().int().min(0).max(300).default(30),
    timeBankRefillSec: z.number().int().min(0).max(60).default(2),
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

export const topUpSchema = z.object({ amount: chips }).strict();
export type TopUpInput = z.infer<typeof topUpSchema>;

export const autoTopUpSchema = z
  .object({ to: z.number().int().min(0).max(1_000_000_000_000) })
  .strict();
export type AutoTopUpInput = z.infer<typeof autoTopUpSchema>;
