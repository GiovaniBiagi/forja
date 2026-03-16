import { z } from "zod";

export const Role = z.enum(["owner", "employee", "client"]);
export type Role = z.infer<typeof Role>;

const normalizedEmail = z
  .string()
  .transform((e) => e.trim().toLowerCase())
  .pipe(z.string().email());

const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

export const RegisterInput = z.object({
  email: normalizedEmail,
  password: strongPassword,
  name: z.string().min(1),
  role: Role.default("client"),
  tenantId: z.string().min(1),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: normalizedEmail,
  password: z.string(),
  tenantId: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshInput>;

export const TokenPayload = z.object({
  sub: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: Role,
  tenantId: z.string(),
});
export type TokenPayload = z.infer<typeof TokenPayload>;

export const AuthUser = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: Role,
  tenantId: z.string(),
});
export type AuthUser = z.infer<typeof AuthUser>;
