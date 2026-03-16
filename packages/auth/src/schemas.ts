import { z } from "zod";

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

/**
 * Creates Zod schemas for auth operations using consumer-defined roles.
 * @param roleSchema - A Zod enum defining the valid roles for this project.
 * @param defaultRole - The default role assigned to new users when no role is specified.
 * @returns Object containing all auth-related Zod schemas.
 */
export function createAuthSchemas<T extends z.ZodEnum<[string, ...string[]]>>(
  roleSchema: T,
  defaultRole: z.infer<T>
) {
  const RegisterInput = z.object({
    email: normalizedEmail,
    password: strongPassword,
    name: z.string().min(1),
    role: roleSchema.default(defaultRole),
    tenantId: z.string().min(1),
  });

  const LoginInput = z.object({
    email: normalizedEmail,
    password: z.string(),
    tenantId: z.string().min(1),
  });

  const RefreshInput = z.object({
    refreshToken: z.string().min(1),
  });

  const TokenPayload = z.object({
    sub: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: roleSchema,
    tenantId: z.string(),
  });

  const AuthUser = z.object({
    id: z.string(),
    email: z.string().email(),
    name: z.string(),
    role: roleSchema,
    tenantId: z.string(),
  });

  return { RegisterInput, LoginInput, RefreshInput, TokenPayload, AuthUser };
}

/** Type helper to extract the inferred types from auth schemas. */
export type AuthSchemas<T extends z.ZodEnum<[string, ...string[]]>> = ReturnType<typeof createAuthSchemas<T>>;
