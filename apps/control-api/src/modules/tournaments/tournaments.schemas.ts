import { z } from 'zod';
import { GAME_TYPES } from '../tables/tables.schemas';

export const START_MODES = ['SIT_AND_GO', 'SCHEDULED'] as const;
export type StartMode = (typeof START_MODES)[number];

export const createTournamentSchema = z
  .object({
    name: z.string().trim().min(3).max(56),
    gameType: z.enum(GAME_TYPES).default('NLHE'),
    buyIn: z.number().int().min(0).max(1_000_000_000_000),
    startingStack: z.number().int().min(100).max(1_000_000_000),
    smallBlind: z.number().int().min(1),
    bigBlind: z.number().int().min(2),
    levelDurationSec: z.number().int().min(10).max(3600),
    seatsPerTable: z.number().int().min(2).max(10).default(6),
    minPlayers: z.number().int().min(2).max(100).default(2),
    maxPlayers: z.number().int().min(2).max(100),
    startMode: z.enum(START_MODES),
    startsAt: z.iso.datetime({ offset: true }).optional(),
    actionTimeoutSec: z.number().int().min(5).max(120).default(20),
  })
  .strict()
  .refine((t) => t.bigBlind >= t.smallBlind, {
    path: ['bigBlind'],
    message: 'must be >= smallBlind',
  })
  .refine((t) => t.startingStack >= 10 * t.bigBlind, {
    path: ['startingStack'],
    message: 'must be at least ten big blinds',
  })
  .refine((t) => t.maxPlayers >= t.minPlayers, {
    path: ['maxPlayers'],
    message: 'must be >= minPlayers',
  })
  .refine((t) => (t.startMode === 'SCHEDULED') === (t.startsAt !== undefined), {
    path: ['startsAt'],
    message: 'required for SCHEDULED and not allowed for SIT_AND_GO',
  })
  .refine((t) => t.startsAt === undefined || Date.parse(t.startsAt) > Date.now(), {
    path: ['startsAt'],
    message: 'must be in the future',
  });
export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
