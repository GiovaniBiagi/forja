import { SignJWT, jwtVerify } from "jose";
import type { TokenPayload } from "./schemas.js";

export interface TokenConfig {
  secret: string;
  accessTokenExpiry?: string;
  refreshTokenExpiry?: string;
  issuer?: string;
}

function getSecretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export const TOKEN_AUDIENCE = {
  access: "forja:access",
  refresh: "forja:refresh",
} as const;

export async function generateAccessToken(
  payload: TokenPayload,
  config: TokenConfig
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.accessTokenExpiry ?? "15m")
    .setIssuer(config.issuer ?? "forja")
    .setAudience(TOKEN_AUDIENCE.access)
    .setSubject(payload.sub)
    .sign(getSecretKey(config.secret));
}

export async function generateRefreshToken(
  payload: TokenPayload,
  config: TokenConfig
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.refreshTokenExpiry ?? "7d")
    .setIssuer(config.issuer ?? "forja")
    .setAudience(TOKEN_AUDIENCE.refresh)
    .setSubject(payload.sub)
    .sign(getSecretKey(config.secret));
}

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
