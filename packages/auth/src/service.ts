import { z } from "zod";
import type {
  AuthStorage,
  TokenBlacklist,
  RefreshTokenStore,
  PasswordResetStorage,
  PasswordUpdateStorage,
  EmailVerificationStorage,
} from "./types.js";
import type { TokenConfig, TokenPayload } from "./tokens.js";
import { createAuthSchemas } from "./schemas.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateTokenPair, verifyAccessToken, verifyRefreshToken } from "./tokens.js";
import { generateOpaqueToken, hashToken } from "./crypto.js";
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
  /** Optional: enables logout / token invalidation. */
  tokenBlacklist?: TokenBlacklist;
  /** Optional: enables refresh token rotation with reuse detection. */
  refreshTokenStore?: RefreshTokenStore;
  /** Optional: enables password reset flow. */
  passwordReset?: {
    storage: PasswordResetStorage;
    passwordStorage: PasswordUpdateStorage;
    /** Token expiry in milliseconds. Defaults to 1 hour. */
    tokenExpiry?: number;
  };
  /** Optional: enables email verification flow. */
  emailVerification?: {
    storage: EmailVerificationStorage;
    /** Token expiry in milliseconds. Defaults to 24 hours. */
    tokenExpiry?: number;
  };
}

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

/**
 * Creates a framework-agnostic auth service with consumer-defined roles.
 * All optional features (logout, refresh rotation, password reset, email verification)
 * are enabled by providing their respective config options.
 * @param config - Storage adapter, token configuration, role definitions, and optional features.
 * @returns Auth service methods typed to the provided roles.
 */
export function createAuthService<T extends z.ZodEnum<[string, ...string[]]>>(
  config: AuthServiceConfig<T>
) {
  const {
    storage,
    tokens,
    roles,
    defaultRole,
    tokenBlacklist,
    refreshTokenStore,
    passwordReset: passwordResetConfig,
    emailVerification: emailVerificationConfig,
  } = config;
  const schemas = createAuthSchemas(roles, defaultRole);

  type Role = z.infer<T>;

  function toTokenPayload(user: { id: string; email: string; name: string; role: string; tenantId: string }): TokenPayload {
    return { sub: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
  }

  async function storeRefreshToken(refreshToken: string, userId: string, tenantId: string, familyId: string): Promise<void> {
    if (!refreshTokenStore) return;
    const tokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 7 * ONE_DAY);
    await refreshTokenStore.store({ tokenHash, userId, tenantId, familyId, expiresAt });
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
    verificationToken?: string;
  }> {
    const parsed = schemas.RegisterInput.parse(input);

    const existing = await storage.findUserByEmail(parsed.email, parsed.tenantId);
    if (existing) throw Errors.emailAlreadyExists();

    const pwHash = await hashPassword(parsed.password);
    const user = await storage.createUser({
      email: parsed.email,
      name: parsed.name,
      role: parsed.role as string,
      tenantId: parsed.tenantId,
      passwordHash: pwHash,
    });

    const tokenPair = await generateTokenPair(toTokenPayload(user), tokens);

    const familyId = crypto.randomUUID();
    await storeRefreshToken(tokenPair.refreshToken, user.id, user.tenantId, familyId);

    const result: {
      user: { id: string; email: string; name: string; role: Role; tenantId: string };
      accessToken: string;
      refreshToken: string;
      verificationToken?: string;
    } = {
      user: user as { id: string; email: string; name: string; role: Role; tenantId: string },
      ...tokenPair,
    };

    if (emailVerificationConfig) {
      const rawToken = generateOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + (emailVerificationConfig.tokenExpiry ?? ONE_DAY));
      await emailVerificationConfig.storage.createVerificationToken({
        tokenHash, userId: user.id, tenantId: user.tenantId, expiresAt,
      });
      result.verificationToken = rawToken;
    }

    return result;
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

    const familyId = crypto.randomUUID();
    await storeRefreshToken(tokenPair.refreshToken, user.id, user.tenantId, familyId);

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

  async function refresh(refreshTokenRaw: string): Promise<{
    accessToken: string;
    refreshToken: string;
  }> {
    let payload: TokenPayload;
    try {
      payload = await verifyRefreshToken(refreshTokenRaw, tokens);
    } catch {
      throw Errors.invalidToken();
    }

    // With refresh token store: rotation + reuse detection
    if (refreshTokenStore) {
      const tokenHash = hashToken(refreshTokenRaw);
      const stored = await refreshTokenStore.find(tokenHash);

      if (!stored) throw Errors.invalidToken();

      if (stored.revoked) {
        await refreshTokenStore.revokeFamily(stored.familyId);
        throw Errors.refreshTokenReuse();
      }

      await refreshTokenStore.revoke(tokenHash);

      const user = await storage.findUserById(payload.sub, payload.tenantId);
      if (!user) throw Errors.userNotFound();

      const tokenPair = await generateTokenPair(toTokenPayload(user), tokens);
      await storeRefreshToken(tokenPair.refreshToken, user.id, user.tenantId, stored.familyId);
      return tokenPair;
    }

    // Without refresh token store: stateless refresh (backward compat)
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

    if (tokenBlacklist && payload.jti) {
      const isRevoked = await tokenBlacklist.isBlacklisted(payload.jti);
      if (isRevoked) throw Errors.tokenRevoked();
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

  async function logout(accessToken: string): Promise<void> {
    if (!tokenBlacklist) throw Errors.featureNotConfigured("Logout");

    let payload: TokenPayload;
    try {
      payload = await verifyAccessToken(accessToken, tokens);
    } catch {
      throw Errors.invalidToken();
    }

    if (!payload.jti || !payload.exp) throw Errors.invalidToken();
    await tokenBlacklist.add(payload.jti, new Date(payload.exp * 1000));
  }

  async function requestPasswordReset(email: string, tenantId: string): Promise<string | null> {
    if (!passwordResetConfig) throw Errors.featureNotConfigured("Password reset");

    const user = await storage.findUserByEmail(email, tenantId);
    if (!user) return null;

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + (passwordResetConfig.tokenExpiry ?? ONE_HOUR));

    await passwordResetConfig.storage.createResetToken({
      tokenHash, userId: user.id, tenantId: user.tenantId, expiresAt,
    });

    return rawToken;
  }

  async function resetPassword(token: string, newPassword: string, tenantId: string): Promise<void> {
    if (!passwordResetConfig) throw Errors.featureNotConfigured("Password reset");

    schemas.ResetPasswordInput.parse({ token, password: newPassword, tenantId });

    const tokenHash = hashToken(token);
    const stored = await passwordResetConfig.storage.findResetToken(tokenHash);

    if (!stored) throw Errors.resetTokenInvalid();
    if (stored.usedAt) throw Errors.resetTokenUsed();
    if (stored.expiresAt < new Date()) throw Errors.resetTokenExpired();

    const pwHash = await hashPassword(newPassword);
    await passwordResetConfig.passwordStorage.updatePassword(stored.userId, stored.tenantId, pwHash);
    await passwordResetConfig.storage.markResetTokenUsed(tokenHash);
  }

  async function verifyEmail(token: string): Promise<void> {
    if (!emailVerificationConfig) throw Errors.featureNotConfigured("Email verification");

    const tokenHash = hashToken(token);
    const stored = await emailVerificationConfig.storage.findVerificationToken(tokenHash);

    if (!stored) throw Errors.verificationTokenInvalid();
    if (stored.usedAt) throw Errors.verificationTokenUsed();
    if (stored.expiresAt < new Date()) throw Errors.verificationTokenExpired();

    await emailVerificationConfig.storage.markEmailVerified(stored.userId, stored.tenantId);
    await emailVerificationConfig.storage.markVerificationTokenUsed(tokenHash);
  }

  async function resendVerificationEmail(email: string, tenantId: string): Promise<string | null> {
    if (!emailVerificationConfig) throw Errors.featureNotConfigured("Email verification");

    const user = await storage.findUserByEmail(email, tenantId);
    if (!user) return null;

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + (emailVerificationConfig.tokenExpiry ?? ONE_DAY));

    await emailVerificationConfig.storage.createVerificationToken({
      tokenHash, userId: user.id, tenantId: user.tenantId, expiresAt,
    });

    return rawToken;
  }

  return {
    register,
    login,
    refresh,
    authenticate,
    authorize,
    logout,
    requestPasswordReset,
    resetPassword,
    verifyEmail,
    resendVerificationEmail,
    schemas,
  };
}

export type AuthService<T extends z.ZodEnum<[string, ...string[]]> = z.ZodEnum<[string, ...string[]]>> = ReturnType<typeof createAuthService<T>>;
