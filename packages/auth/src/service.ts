import { z } from "zod";
import type { AuthStorage } from "./types.js";
import type { TokenConfig, TokenPayload } from "./tokens.js";
import { createAuthSchemas } from "./schemas.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateTokenPair, verifyAccessToken, verifyRefreshToken } from "./tokens.js";
import { Errors } from "./errors.js";

/** Configuration for creating an auth service instance. */
export interface AuthServiceConfig<T extends z.ZodEnum<[string, ...string[]]>> {
  /** Storage adapter for persisting and querying users. */
  storage: AuthStorage;
  /** JWT token configuration (secret, expiry, issuer). */
  tokens: TokenConfig;
  /** Zod enum defining the valid roles for this project. */
  roles: T;
  /** Default role assigned when no role is provided during registration. */
  defaultRole: z.infer<T>;
}

/**
 * Creates a framework-agnostic auth service with consumer-defined roles.
 * @param config - Storage adapter, token configuration, and role definitions.
 * @returns Auth service methods typed to the provided roles.
 */
export function createAuthService<T extends z.ZodEnum<[string, ...string[]]>>(
  config: AuthServiceConfig<T>
) {
  const { storage, tokens, roles, defaultRole } = config;
  const schemas = createAuthSchemas(roles, defaultRole);

  type Role = z.infer<T>;

  function toTokenPayload(user: { id: string; email: string; name: string; role: string; tenantId: string }): TokenPayload {
    return { sub: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
  }

  async function register(input: {
    email: string;
    password: string;
    name: string;
    role?: Role;
    tenantId: string;
  }): Promise<{
    user: { id: string; email: string; name: string; role: Role; tenantId: string };
    accessToken: string;
    refreshToken: string;
  }> {
    const parsed = schemas.RegisterInput.parse(input);

    const existing = await storage.findUserByEmail(parsed.email, parsed.tenantId);
    if (existing) throw Errors.emailAlreadyExists();

    const passwordHash = await hashPassword(parsed.password);
    const user = await storage.createUser({
      email: parsed.email,
      name: parsed.name,
      role: parsed.role as string,
      tenantId: parsed.tenantId,
      passwordHash,
    });

    const tokenPair = await generateTokenPair(toTokenPayload(user), tokens);

    return {
      user: user as { id: string; email: string; name: string; role: Role; tenantId: string },
      ...tokenPair,
    };
  }

  async function login(input: { email: string; password: string; tenantId: string }): Promise<{
    user: { id: string; email: string; name: string; role: Role; tenantId: string };
    accessToken: string;
    refreshToken: string;
  }> {
    const parsed = schemas.LoginInput.parse(input);

    const user = await storage.findUserByEmail(parsed.email, parsed.tenantId);
    if (!user) throw Errors.invalidCredentials();

    const valid = await verifyPassword(user.passwordHash, parsed.password);
    if (!valid) throw Errors.invalidCredentials();

    const tokenPair = await generateTokenPair(toTokenPayload(user), tokens);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as Role,
        tenantId: user.tenantId,
      },
      ...tokenPair,
    };
  }

  async function refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    let payload: TokenPayload;
    try {
      payload = await verifyRefreshToken(refreshToken, tokens);
    } catch {
      throw Errors.invalidToken();
    }

    const user = await storage.findUserById(payload.sub, payload.tenantId);
    if (!user) throw Errors.userNotFound();

    return generateTokenPair(toTokenPayload(user), tokens);
  }

  async function authenticate(accessToken: string): Promise<{
    id: string;
    email: string;
    name: string;
    role: Role;
    tenantId: string;
  }> {
    let payload: TokenPayload;
    try {
      payload = await verifyAccessToken(accessToken, tokens);
    } catch {
      throw Errors.invalidToken();
    }

    const user = await storage.findUserById(payload.sub, payload.tenantId);
    if (!user) throw Errors.userNotFound();

    return user as { id: string; email: string; name: string; role: Role; tenantId: string };
  }

  function authorize(...allowedRoles: Role[]) {
    return (user: { id: string; email: string; name: string; role: Role; tenantId: string }): void => {
      if (!allowedRoles.includes(user.role)) {
        throw Errors.forbidden();
      }
    };
  }

  return {
    register,
    login,
    refresh,
    authenticate,
    authorize,
    schemas,
  };
}

export type AuthService<T extends z.ZodEnum<[string, ...string[]]> = z.ZodEnum<[string, ...string[]]>> = ReturnType<typeof createAuthService<T>>;
