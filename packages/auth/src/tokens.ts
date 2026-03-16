import { SignJWT, jwtVerify } from "jose";

/** Base token payload structure. Role is a string to support any consumer-defined roles. */
export interface TokenPayload {
  sub: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  /** JWT ID — unique identifier for this token. Used for blacklisting and rotation. */
  jti?: string;
  /** Expiration timestamp (seconds since epoch). Present after verification. */
  exp?: number;
}

/** JWT token configuration. */
export interface TokenConfig {
  /** HMAC secret used to sign and verify tokens. */
  secret: string;
  /** Access token expiry (e.g., "15m", "1h"). Defaults to "15m". */
  accessTokenExpiry?: string;
  /** Refresh token expiry (e.g., "7d", "30d"). Defaults to "7d". */
  refreshTokenExpiry?: string;
  /** Token issuer claim. Defaults to "forja". */
  issuer?: string;
}

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export const TOKEN_AUDIENCE = {
  access: "forja:access",
  refresh: "forja:refresh",
} as const;

/**
 * Generates a short-lived access token with the "forja:access" audience.
 * @param payload - User data to encode in the token.
 * @param config - Token configuration.
 * @returns Signed JWT string.
 */
export async function generateAccessToken(
  payload: TokenPayload,
  config: TokenConfig
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(config.accessTokenExpiry ?? "15m")
    .setIssuer(config.issuer ?? "forja")
    .setAudience(TOKEN_AUDIENCE.access)
    .setSubject(payload.sub)
    .sign(getSecretKey(config.secret));
}

/**
 * Generates a long-lived refresh token with the "forja:refresh" audience.
 * @param payload - User data to encode in the token.
 * @param config - Token configuration.
 * @returns Signed JWT string.
 */
export async function generateRefreshToken(
  payload: TokenPayload,
  config: TokenConfig
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(config.refreshTokenExpiry ?? "7d")
    .setIssuer(config.issuer ?? "forja")
    .setAudience(TOKEN_AUDIENCE.refresh)
    .setSubject(payload.sub)
    .sign(getSecretKey(config.secret));
}

/**
 * Generates both an access and refresh token in parallel.
 * @param payload - User data to encode in both tokens.
 * @param config - Token configuration.
 * @returns Object with `accessToken` and `refreshToken` strings.
 */
export async function generateTokenPair(
  payload: TokenPayload,
  config: TokenConfig
): Promise<{ accessToken: string; refreshToken: string }> {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(payload, config),
    generateRefreshToken(payload, config),
  ]);
  return { accessToken, refreshToken };
}

/**
 * Verifies an access token's signature, issuer, audience, and expiration.
 * @param token - The JWT string to verify.
 * @param config - Token configuration (must match the signing config).
 * @returns Decoded token payload.
 * @throws If the token is invalid, expired, or has the wrong audience.
 */
export async function verifyAccessToken(
  token: string,
  config: TokenConfig
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(config.secret), {
    issuer: config.issuer ?? "forja",
    audience: TOKEN_AUDIENCE.access,
  });

  return payload as unknown as TokenPayload;
}

/**
 * Verifies a refresh token's signature, issuer, audience, and expiration.
 * @param token - The JWT string to verify.
 * @param config - Token configuration (must match the signing config).
 * @returns Decoded token payload.
 * @throws If the token is invalid, expired, or has the wrong audience.
 */
export async function verifyRefreshToken(
  token: string,
  config: TokenConfig
): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, getSecretKey(config.secret), {
    issuer: config.issuer ?? "forja",
    audience: TOKEN_AUDIENCE.refresh,
  });

  return payload as unknown as TokenPayload;
}
