import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod";
import { createAuthService } from "./service.js";
import { hashToken } from "./crypto.js";
import type {
  AuthStorage,
  StoredUser,
  TokenBlacklist,
  RefreshTokenStore,
  PasswordResetStorage,
  PasswordUpdateStorage,
  EmailVerificationStorage,
} from "./types.js";

const BarberRole = z.enum(["owner", "barber", "client"]);
const tokenConfig = { secret: "test-secret-that-is-long-enough-for-hmac" };

function createMockStorage(): AuthStorage & { users: StoredUser[] } {
  const users: StoredUser[] = [];
  return {
    users,
    async findUserByEmail(email: string, tenantId: string) {
      return users.find((u) => u.email === email && u.tenantId === tenantId) ?? null;
    },
    async createUser(input) {
      const user: StoredUser = {
        id: `user-${users.length + 1}`,
        email: input.email,
        name: input.name,
        role: input.role,
        tenantId: input.tenantId,
        passwordHash: input.passwordHash,
      };
      users.push(user);
      return { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    },
    async findUserById(id: string, tenantId: string) {
      const user = users.find((u) => u.id === id && u.tenantId === tenantId);
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
    },
  };
}

function createMockBlacklist(): TokenBlacklist & { entries: Map<string, Date> } {
  const entries = new Map<string, Date>();
  return {
    entries,
    async add(jti, expiresAt) { entries.set(jti, expiresAt); },
    async isBlacklisted(jti) { return entries.has(jti); },
  };
}

function createMockRefreshTokenStore(): RefreshTokenStore & { tokens: Map<string, { userId: string; tenantId: string; familyId: string; revoked: boolean; expiresAt: Date }> } {
  const tokens = new Map<string, { userId: string; tenantId: string; familyId: string; revoked: boolean; expiresAt: Date }>();
  return {
    tokens,
    async store(input) {
      tokens.set(input.tokenHash, { userId: input.userId, tenantId: input.tenantId, familyId: input.familyId, revoked: false, expiresAt: input.expiresAt });
    },
    async find(tokenHash) { return tokens.get(tokenHash) ?? null; },
    async revoke(tokenHash) {
      const t = tokens.get(tokenHash);
      if (t) t.revoked = true;
    },
    async revokeFamily(familyId) {
      for (const [, t] of tokens) {
        if (t.familyId === familyId) t.revoked = true;
      }
    },
  };
}

function createMockPasswordResetStorage(): PasswordResetStorage & { tokens: Map<string, { userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null }> } {
  const tokens = new Map<string, { userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null }>();
  return {
    tokens,
    async createResetToken(input) {
      tokens.set(input.tokenHash, { userId: input.userId, tenantId: input.tenantId, expiresAt: input.expiresAt, usedAt: null });
    },
    async findResetToken(tokenHash) { return tokens.get(tokenHash) ?? null; },
    async markResetTokenUsed(tokenHash) {
      const t = tokens.get(tokenHash);
      if (t) t.usedAt = new Date();
    },
  };
}

function createMockPasswordUpdateStorage(users: StoredUser[]): PasswordUpdateStorage {
  return {
    async updatePassword(userId, tenantId, passwordHash) {
      const user = users.find((u) => u.id === userId && u.tenantId === tenantId);
      if (user) user.passwordHash = passwordHash;
    },
  };
}

function createMockEmailVerificationStorage(): EmailVerificationStorage & {
  tokens: Map<string, { userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null }>;
  verifiedUsers: Set<string>;
} {
  const tokens = new Map<string, { userId: string; tenantId: string; expiresAt: Date; usedAt: Date | null }>();
  const verifiedUsers = new Set<string>();
  return {
    tokens,
    verifiedUsers,
    async createVerificationToken(input) {
      tokens.set(input.tokenHash, { userId: input.userId, tenantId: input.tenantId, expiresAt: input.expiresAt, usedAt: null });
    },
    async findVerificationToken(tokenHash) { return tokens.get(tokenHash) ?? null; },
    async markVerificationTokenUsed(tokenHash) {
      const t = tokens.get(tokenHash);
      if (t) t.usedAt = new Date();
    },
    async markEmailVerified(userId, tenantId) {
      verifiedUsers.add(`${userId}:${tenantId}`);
    },
  };
}

const validRegisterInput = {
  email: "test@example.com",
  password: "Secret1!x",
  name: "Test",
  role: "client" as const,
  tenantId: "t1",
};

// ==================== Core features (backward compat) ====================

describe("AuthService", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let service: ReturnType<typeof createAuthService<typeof BarberRole>>;

  beforeEach(() => {
    storage = createMockStorage();
    service = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client" });
  });

  describe("register", () => {
    it("creates user and returns tokens", async () => {
      const result = await service.register(validRegisterInput);
      expect(result.user.email).toBe("test@example.com");
      expect(result.user.id).toBe("user-1");
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it("uses default role when none provided", async () => {
      const result = await service.register({ ...validRegisterInput, role: undefined });
      expect(result.user.role).toBe("client");
    });

    it("accepts consumer-defined role", async () => {
      const result = await service.register({ ...validRegisterInput, email: "barber@example.com", role: "barber" });
      expect(result.user.role).toBe("barber");
    });

    it("rejects duplicate email in same tenant", async () => {
      await service.register(validRegisterInput);
      await expect(service.register({ ...validRegisterInput, name: "Test 2" })).rejects.toThrow("Email already registered");
    });

    it("allows same email in different tenants", async () => {
      await service.register(validRegisterInput);
      const result = await service.register({ ...validRegisterInput, tenantId: "t2" });
      expect(result.user.tenantId).toBe("t2");
    });
  });

  describe("login", () => {
    beforeEach(async () => { await service.register(validRegisterInput); });

    it("returns tokens for valid credentials", async () => {
      const result = await service.login({ email: "test@example.com", password: "Secret1!x", tenantId: "t1" });
      expect(result.user.email).toBe("test@example.com");
      expect(result.accessToken).toBeTruthy();
    });

    it("rejects wrong password", async () => {
      await expect(service.login({ email: "test@example.com", password: "WrongPass1!", tenantId: "t1" })).rejects.toThrow("Invalid email or password");
    });

    it("rejects non-existent email", async () => {
      await expect(service.login({ email: "nobody@example.com", password: "Secret1!x", tenantId: "t1" })).rejects.toThrow("Invalid email or password");
    });

    it("rejects valid credentials for wrong tenant", async () => {
      await expect(service.login({ email: "test@example.com", password: "Secret1!x", tenantId: "wrong" })).rejects.toThrow("Invalid email or password");
    });
  });

  describe("refresh", () => {
    it("returns new token pair from valid refresh token", async () => {
      const { refreshToken } = await service.register(validRegisterInput);
      const result = await service.refresh(refreshToken);
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it("rejects invalid refresh token", async () => {
      await expect(service.refresh("garbage")).rejects.toThrow("Invalid or expired token");
    });

    it("rejects access token used as refresh token", async () => {
      const { accessToken } = await service.register(validRegisterInput);
      await expect(service.refresh(accessToken)).rejects.toThrow("Invalid or expired token");
    });
  });

  describe("authenticate", () => {
    it("returns user from valid access token", async () => {
      const { accessToken } = await service.register(validRegisterInput);
      const user = await service.authenticate(accessToken);
      expect(user.email).toBe("test@example.com");
    });

    it("rejects refresh token used as access token", async () => {
      const { refreshToken } = await service.register(validRegisterInput);
      await expect(service.authenticate(refreshToken)).rejects.toThrow("Invalid or expired token");
    });
  });

  describe("authorize", () => {
    it("allows user with correct role", () => {
      const check = service.authorize("owner", "barber");
      expect(() => check({ id: "1", email: "a@b.com", name: "A", role: "owner", tenantId: "t1" })).not.toThrow();
    });

    it("rejects user with wrong role", () => {
      const check = service.authorize("owner");
      expect(() => check({ id: "1", email: "a@b.com", name: "A", role: "client", tenantId: "t1" })).toThrow("Insufficient permissions");
    });

    it("works with consumer-defined roles", () => {
      const check = service.authorize("barber");
      expect(() => check({ id: "1", email: "a@b.com", name: "A", role: "barber", tenantId: "t1" })).not.toThrow();
      expect(() => check({ id: "1", email: "a@b.com", name: "A", role: "owner", tenantId: "t1" })).toThrow("Insufficient permissions");
    });
  });
});

// ==================== Feature: Logout / Token Invalidation ====================

describe("AuthService — logout", () => {
  it("invalidates access token after logout", async () => {
    const storage = createMockStorage();
    const blacklist = createMockBlacklist();
    const service = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client", tokenBlacklist: blacklist });

    const { accessToken } = await service.register(validRegisterInput);

    // Token works before logout
    const user = await service.authenticate(accessToken);
    expect(user.email).toBe("test@example.com");

    // Logout
    await service.logout(accessToken);

    // Token rejected after logout
    await expect(service.authenticate(accessToken)).rejects.toThrow("Token has been revoked");
  });

  it("other tokens still work after one is logged out", async () => {
    const storage = createMockStorage();
    const blacklist = createMockBlacklist();
    const service = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client", tokenBlacklist: blacklist });

    const { accessToken: token1 } = await service.register(validRegisterInput);
    const { accessToken: token2 } = await service.login({ email: "test@example.com", password: "Secret1!x", tenantId: "t1" });

    await service.logout(token1);

    // token1 is revoked
    await expect(service.authenticate(token1)).rejects.toThrow("Token has been revoked");
    // token2 still works
    const user = await service.authenticate(token2);
    expect(user.email).toBe("test@example.com");
  });

  it("throws when logout is called without blacklist configured", async () => {
    const storage = createMockStorage();
    const service = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client" });

    const { accessToken } = await service.register(validRegisterInput);
    await expect(service.logout(accessToken)).rejects.toThrow("Logout requires additional configuration");
  });
});

// ==================== Feature: Refresh Token Rotation ====================

describe("AuthService — refresh token rotation", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let refreshStore: ReturnType<typeof createMockRefreshTokenStore>;
  let service: ReturnType<typeof createAuthService<typeof BarberRole>>;

  beforeEach(() => {
    storage = createMockStorage();
    refreshStore = createMockRefreshTokenStore();
    service = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client", refreshTokenStore: refreshStore });
  });

  it("issues new tokens on refresh and old one no longer works", async () => {
    const { refreshToken: oldRefresh } = await service.register(validRegisterInput);

    const newPair = await service.refresh(oldRefresh);
    expect(newPair.accessToken).toBeTruthy();
    expect(newPair.refreshToken).toBeTruthy();

    // Old refresh token is now revoked
    await expect(service.refresh(oldRefresh)).rejects.toThrow("Refresh token reuse detected");
  });

  it("detects reuse and revokes entire token family", async () => {
    const { refreshToken: token1 } = await service.register(validRegisterInput);
    const { refreshToken: token2 } = await service.refresh(token1);

    // Simulate attacker reusing token1 (already revoked)
    await expect(service.refresh(token1)).rejects.toThrow("Refresh token reuse detected");

    // token2 should also be revoked now (family revoked)
    await expect(service.refresh(token2)).rejects.toThrow("Refresh token reuse detected");
  });

  it("works statelessly without refreshTokenStore (backward compat)", async () => {
    const service2 = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client" });
    const { refreshToken } = await service2.register({ ...validRegisterInput, email: "other@example.com" });
    const result = await service2.refresh(refreshToken);
    expect(result.accessToken).toBeTruthy();
  });
});

// ==================== Feature: Password Reset ====================

describe("AuthService — password reset", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let resetStorage: ReturnType<typeof createMockPasswordResetStorage>;
  let service: ReturnType<typeof createAuthService<typeof BarberRole>>;

  beforeEach(async () => {
    storage = createMockStorage();
    resetStorage = createMockPasswordResetStorage();
    const passwordUpdateStorage = createMockPasswordUpdateStorage(storage.users);
    service = createAuthService({
      storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client",
      passwordReset: { storage: resetStorage, passwordStorage: passwordUpdateStorage },
    });
    await service.register(validRegisterInput);
  });

  it("generates reset token for existing user", async () => {
    const token = await service.requestPasswordReset("test@example.com", "t1");
    expect(token).toBeTruthy();
    expect(typeof token).toBe("string");
  });

  it("returns null for non-existent user (no information leak)", async () => {
    const token = await service.requestPasswordReset("nobody@example.com", "t1");
    expect(token).toBeNull();
  });

  it("resets password with valid token", async () => {
    const token = await service.requestPasswordReset("test@example.com", "t1");
    await service.resetPassword(token!, "NewSecret1!x", "t1");

    // Old password no longer works
    await expect(service.login({ email: "test@example.com", password: "Secret1!x", tenantId: "t1" })).rejects.toThrow("Invalid email or password");

    // New password works
    const result = await service.login({ email: "test@example.com", password: "NewSecret1!x", tenantId: "t1" });
    expect(result.user.email).toBe("test@example.com");
  });

  it("rejects already-used reset token", async () => {
    const token = await service.requestPasswordReset("test@example.com", "t1");
    await service.resetPassword(token!, "NewSecret1!x", "t1");
    await expect(service.resetPassword(token!, "Another1!x", "t1")).rejects.toThrow("Reset token has already been used");
  });

  it("rejects expired reset token", async () => {
    const token = await service.requestPasswordReset("test@example.com", "t1");
    // Manually expire the token
    const tokenHash = hashToken(token!);
    const stored = resetStorage.tokens.get(tokenHash)!;
    stored.expiresAt = new Date(Date.now() - 1000);

    await expect(service.resetPassword(token!, "NewSecret1!x", "t1")).rejects.toThrow("Reset token has expired");
  });

  it("rejects invalid reset token", async () => {
    await expect(service.resetPassword("invalid-token", "NewSecret1!x", "t1")).rejects.toThrow("Invalid reset token");
  });

  it("validates new password strength", async () => {
    const token = await service.requestPasswordReset("test@example.com", "t1");
    await expect(service.resetPassword(token!, "weak", "t1")).rejects.toThrow();
  });

  it("throws when feature is not configured", async () => {
    const service2 = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client" });
    await expect(service2.requestPasswordReset("test@example.com", "t1")).rejects.toThrow("Password reset requires additional configuration");
  });
});

// ==================== Feature: Email Verification ====================

describe("AuthService — email verification", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let verificationStorage: ReturnType<typeof createMockEmailVerificationStorage>;
  let service: ReturnType<typeof createAuthService<typeof BarberRole>>;

  beforeEach(() => {
    storage = createMockStorage();
    verificationStorage = createMockEmailVerificationStorage();
    service = createAuthService({
      storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client",
      emailVerification: { storage: verificationStorage },
    });
  });

  it("returns verification token on register when configured", async () => {
    const result = await service.register(validRegisterInput);
    expect(result.verificationToken).toBeTruthy();
    expect(typeof result.verificationToken).toBe("string");
  });

  it("does not return verification token when not configured", async () => {
    const service2 = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client" });
    const result = await service2.register({ ...validRegisterInput, email: "other@example.com" });
    expect(result.verificationToken).toBeUndefined();
  });

  it("verifies email with valid token", async () => {
    const { verificationToken, user } = await service.register(validRegisterInput);
    await service.verifyEmail(verificationToken!);
    expect(verificationStorage.verifiedUsers.has(`${user.id}:${user.tenantId}`)).toBe(true);
  });

  it("rejects already-used verification token", async () => {
    const { verificationToken } = await service.register(validRegisterInput);
    await service.verifyEmail(verificationToken!);
    await expect(service.verifyEmail(verificationToken!)).rejects.toThrow("Email has already been verified");
  });

  it("rejects expired verification token", async () => {
    const { verificationToken } = await service.register(validRegisterInput);
    // Manually expire
    const tokenHash = hashToken(verificationToken!);
    const stored = verificationStorage.tokens.get(tokenHash)!;
    stored.expiresAt = new Date(Date.now() - 1000);

    await expect(service.verifyEmail(verificationToken!)).rejects.toThrow("Verification token has expired");
  });

  it("rejects invalid verification token", async () => {
    await expect(service.verifyEmail("invalid-token")).rejects.toThrow("Invalid verification token");
  });

  it("resends verification email for existing user", async () => {
    await service.register(validRegisterInput);
    const token = await service.resendVerificationEmail("test@example.com", "t1");
    expect(token).toBeTruthy();
  });

  it("returns null when resending for non-existent user", async () => {
    const token = await service.resendVerificationEmail("nobody@example.com", "t1");
    expect(token).toBeNull();
  });

  it("throws when feature is not configured", async () => {
    const service2 = createAuthService({ storage, tokens: tokenConfig, roles: BarberRole, defaultRole: "client" });
    await expect(service2.verifyEmail("some-token")).rejects.toThrow("Email verification requires additional configuration");
  });
});

// ==================== Championship roles (cross-project compat) ====================

describe("AuthService with championship roles", () => {
  const ChampionshipRole = z.enum(["admin", "organizer", "player", "spectator"]);

  it("works with championship-specific roles", async () => {
    const storage: AuthStorage = {
      async findUserByEmail() { return null; },
      async createUser(input) {
        return { id: "1", email: input.email, name: input.name, role: input.role, tenantId: input.tenantId };
      },
      async findUserById(id, tenantId) {
        return { id, email: "a@b.com", name: "A", role: "player", tenantId };
      },
    };

    const service = createAuthService({
      storage, tokens: tokenConfig, roles: ChampionshipRole, defaultRole: "spectator",
    });

    const result = await service.register({
      email: "player@test.com", password: "Secret1!x", name: "Player", role: "player", tenantId: "championship-1",
    });
    expect(result.user.role).toBe("player");

    const check = service.authorize("admin", "organizer");
    expect(() => check({ id: "1", email: "a@b.com", name: "A", role: "spectator", tenantId: "t1" })).toThrow("Insufficient permissions");
  });
});
