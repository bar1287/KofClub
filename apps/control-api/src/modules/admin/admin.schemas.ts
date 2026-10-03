import { z } from 'zod';
import { cursorSchema, limitSchema, uuidSchema } from '../../common/validation/schemas';

export const searchQuerySchema = z.object({
  q: z.string().trim().max(64).optional(),
  limit: limitSchema,
  cursor: cursorSchema,
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

const reason = z.string().trim().min(3).max(500);

export const updateUserStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason })
  .strict();
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;

export const updateClubStatusSchema = z
  .object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason })
  .strict();
export type UpdateClubStatusInput = z.infer<typeof updateClubStatusSchema>;

export const auditQuerySchema = z.object({
  clubId: uuidSchema.optional(),
  actorUserId: uuidSchema.optional(),
  action: z
    .string()
    .regex(/^[A-Z_]{3,64}$/)
    .optional(),
  limit: limitSchema,
  cursor: cursorSchema,
});
export type AdminAuditQuery = z.infer<typeof auditQuerySchema>;

export const riskQuerySchema = z.object({
  status: z.enum(['OPEN', 'REVIEWED']).default('OPEN'),
  limit: limitSchema,
  cursor: cursorSchema,
});
export type RiskQuery = z.infer<typeof riskQuerySchema>;

export const reviewRiskSchema = z
  .object({
    disposition: z.enum(['DISMISSED', 'CONFIRMED', 'ESCALATED']),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
export type ReviewRiskInput = z.infer<typeof reviewRiskSchema>;
