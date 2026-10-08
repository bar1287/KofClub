import { z } from 'zod';

export const createClubSchema = z
  .object({
    name: z.string().trim().min(3).max(64),
    description: z.string().trim().max(500).optional(),
  })
  .strict();
export type CreateClubInput = z.infer<typeof createClubSchema>;

export const updateClubSchema = z
  .object({
    name: z.string().trim().min(3).max(64).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    tableChat: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.description !== undefined || v.tableChat !== undefined, {
    message: 'name, description or tableChat required',
  });
export type UpdateClubInput = z.infer<typeof updateClubSchema>;

export const transferOwnershipSchema = z.object({ userId: z.string().uuid() }).strict();
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

/** Accepts codes typed by humans: case-insensitive, spaces/dashes ignored. */
export const joinCodeSchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{6,16}$/, 'invalid code format'));

export const joinClubSchema = z.object({ code: joinCodeSchema }).strict();
export type JoinClubInput = z.infer<typeof joinClubSchema>;

export const updateMemberSchema = z
  .object({
    role: z.enum(['ADMIN', 'AGENT', 'MEMBER']).optional(),
    status: z.enum(['ACTIVE', 'BANNED']).optional(),
  })
  .strict()
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'role or status required',
  });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;

export const createInviteSchema = z
  .object({
    role: z.enum(['MEMBER', 'AGENT']).default('MEMBER'),
    maxUses: z.number().int().min(1).max(10000).default(1),
    expiresInHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .default(72),
  })
  .strict();
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const listMembersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(512).optional(),
  status: z.enum(['ACTIVE', 'BANNED', 'LEFT']).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
