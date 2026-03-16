import { describe, it, expect } from "vitest";
import {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  TOKEN_AUDIENCE,
} from "./tokens.js";
import type { TokenPayload } from "./schemas.js";
import type { TokenConfig } from "./tokens.js";

const config: TokenConfig = {
  secret: "test-secret-that-is-long-enough-for-hmac",
  accessTokenExpiry: "15m",
  refreshTokenExpiry: "7d",
};

const payload: TokenPayload = {
  sub: "user-1",
  email: "test@example.com",
  name: "Test User",
  role: "client",
  tenantId: "tenant-1",
};

describe("tokens", () => {
  it("generates and verifies access token", async () => {
    const token = await generateAccessToken(payload, config);
    const decoded = await verifyAccessToken(token, config);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.email).toBe("test@example.com");
    expect(decoded.tenantId).toBe("tenant-1");
  });

  it("generates and verifies refresh token", async () => {
    const token = await generateRefreshToken(payload, config);
    const decoded = await verifyRefreshToken(token, config);
    expect(decoded.sub).toBe("user-1");
  });

  it("rejects access token verified as refresh token", async () => {
    const token = await generateAccessToken(payload, config);
    await expect(verifyRefreshToken(token, config)).rejects.toThrow();
  });

  it("rejects refresh token verified as access token", async () => {
    const token = await generateRefreshToken(payload, config);
    await expect(verifyAccessToken(token, config)).rejects.toThrow();
  });

  it("generates a token pair", async () => {
    const pair = await generateTokenPair(payload, config);
    expect(pair.accessToken).toBeTruthy();
    expect(pair.refreshToken).toBeTruthy();
    expect(pair.accessToken).not.toBe(pair.refreshToken);
  });

  it("rejects token with wrong secret", async () => {
    const token = await generateAccessToken(payload, config);
    const wrongConfig = { ...config, secret: "wrong-secret" };
    await expect(verifyAccessToken(token, wrongConfig)).rejects.toThrow();
  });

  it("rejects token with wrong issuer", async () => {
    const token = await generateAccessToken(payload, { ...config, issuer: "other" });
    await expect(verifyAccessToken(token, config)).rejects.toThrow();
  });
});
