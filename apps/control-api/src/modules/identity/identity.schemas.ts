import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_]{3,24}$/, 'must be 3-24 letters, digits or underscores');

export const passwordSchema = z.string().min(10, 'must be at least 10 characters').max(128);

const deviceIdSchema = z.string().trim().min(1).max(128).optional();

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    username: usernameSchema,
    password: passwordSchema,
    deviceId: deviceIdSchema,
  })
  .strict()
  .refine(
    (v) =>
      v.password.toLowerCase() !== v.username.toLowerCase() && v.password.toLowerCase() !== v.email,
    {
      path: ['password'],
      message: 'must not equal the username or email',
    },
  );
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    login: z.string().trim().min(3).max(254),
    password: z.string().min(1).max(128),
    deviceId: deviceIdSchema,
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z
  .object({ refreshToken: z.string().min(10).max(256).optional() })
  .strict()
  .default({});
export type RefreshInput = z.infer<typeof refreshSchema>;
