import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('must be a valid email address'));

// bcrypt only uses the first 72 bytes of a password; reject longer ones instead of silently truncating.
const passwordSchema = z
  .string()
  .max(72)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'must be at most 72 bytes');

export const registerSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema.check(z.minLength(8, 'must be at least 8 characters')),
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: passwordSchema.check(z.minLength(1, 'is required')),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
