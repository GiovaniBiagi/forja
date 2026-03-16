import type { AuthStorage } from "./types.js";
import type { TokenConfig } from "./tokens.js";
import type { AuthUser, LoginInput, RegisterInput, Role, TokenPayload } from "./schemas.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateTokenPair, verifyAccessToken, verifyRefreshToken } from "./tokens.js";
import { Errors } from "./errors.js";

/** Configuration for creating an auth service instance. */
export interface AuthServiceConfig {
  /** Storage adapter for persisting and querying users. */
  storage: AuthStorage;
  /** JWT token configuration (secret, expiry, issuer). */
  tokens: TokenConfig;
}

/**
 * Creates a framework-agnostic auth service with register, login, refresh, authenticate, and authorize capabilities.
 * @param config - Storage adapter and token configuration.
 * @returns Auth service methods.
 */
export function createAuthService(config: AuthServiceConfig) {
  const { storage, tokens } = config;

  async function register(input: RegisterInput): Promise<{
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
  }> {
    const existing = await storage.findUserByEmail(input.email, input.tenantId);
    if (existing) throw Errors.emailAlreadyExists();

    const passwordHash = await hashPassword(input.password);
    const user = await storage.createUser({ ...input, passwordHash });

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    };

    const tokenPair = await generateTokenPair(payload, tokens);

    return { user, ...tokenPair };
  }

  async function login(input: LoginInput): Promise<{
    user: AuthUser;
    accessToken: string;
    refreshToken: string;
  }> {
    const user = await storage.findUserByEmail(input.email, input.tenantId);
    if (!user) throw Errors.invalidCredentials();

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) throw Errors.invalidCredentials();

    const payload: TokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      tenantId: user.tenantId,
    };

    const tokenPair = await generateTokenPair(payload, tokens);

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

    const newPayload: TokenPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenantId,
    };

    return generateTokenPair(newPayload, tokens);
  }

  async function authenticate(accessToken: string): Promise<AuthUser> {
    let payload: TokenPayload;
    try {
      payload = await verifyAccessToken(accessToken, tokens);
    } catch {
      throw Errors.invalidToken();
    }

    const user = await storage.findUserById(payload.sub, payload.tenantId);
    if (!user) throw Errors.userNotFound();

    return user;
  }

  function authorize(...allowedRoles: Role[]) {
    return (user: AuthUser): void => {
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
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
