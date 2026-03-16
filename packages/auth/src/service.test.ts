import { describe, it, expect, beforeEach } from "vitest";
import { createAuthService } from "./service.js";
import type { AuthStorage, StoredUser } from "./types.js";
import type { AuthUser, RegisterInput } from "./schemas.js";
import { hashPassword } from "./password.js";

function createMockStorage(): AuthStorage & { users: StoredUser[] } {
  const users: StoredUser[] = [];

  return {
    users,
    async findUserByEmail(email: string, tenantId: string) {
      return users.find((u) => u.email === email && u.tenantId === tenantId) ?? null;
    },
    async createUser(input: RegisterInput & { passwordHash: string }): Promise<AuthUser> {
      const user: StoredUser = {
        id: `user-${users.length + 1}`,
        email: input.email,
        name: input.name,
        role: input.role,
        tenantId: input.tenantId,
        passwordHash: input.passwordHash,
      };
      users.push(user);
      return { id: user.id, email: user.email, name: user.name, role: user.role as AuthUser["role"], tenantId: user.tenantId };
    },
    async findUserById(id: string, tenantId: string) {
      const user = users.find((u) => u.id === id && u.tenantId === tenantId);
      if (!user) return null;
      return { id: user.id, email: user.email, name: user.name, role: user.role as AuthUser["role"], tenantId: user.tenantId };
    },
  };
}

const tokenConfig = { secret: "test-secret-that-is-long-enough-for-hmac" };

describe("AuthService", () => {
  let storage: ReturnType<typeof createMockStorage>;
  let service: ReturnType<typeof createAuthService>;

  beforeEach(() => {
    storage = createMockStorage();
    service = createAuthService({ storage, tokens: tokenConfig });
  });

  describe("register", () => {
    it("creates user and returns tokens", async () => {
      const result = await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      expect(result.user.email).toBe("test@example.com");
      expect(result.user.id).toBe("user-1");
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it("rejects duplicate email in same tenant", async () => {
      await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      await expect(
        service.register({
          email: "test@example.com",
          password: "Secret1!x",
          name: "Test 2",
          role: "client",
          tenantId: "t1",
        })
      ).rejects.toThrow("Email already registered");
    });

    it("allows same email in different tenants", async () => {
      await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      const result = await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t2",
      });

      expect(result.user.tenantId).toBe("t2");
    });
  });

  describe("login", () => {
    beforeEach(async () => {
      await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });
    });

    it("returns tokens for valid credentials", async () => {
      const result = await service.login({
        email: "test@example.com",
        password: "Secret1!x",
        tenantId: "t1",
      });

      expect(result.user.email).toBe("test@example.com");
      expect(result.accessToken).toBeTruthy();
    });

    it("rejects wrong password", async () => {
      await expect(
        service.login({
          email: "test@example.com",
          password: "WrongPass1!",
          tenantId: "t1",
        })
      ).rejects.toThrow("Invalid email or password");
    });

    it("rejects non-existent email", async () => {
      await expect(
        service.login({
          email: "nobody@example.com",
          password: "Secret1!x",
          tenantId: "t1",
        })
      ).rejects.toThrow("Invalid email or password");
    });

    it("rejects valid credentials for wrong tenant", async () => {
      await expect(
        service.login({
          email: "test@example.com",
          password: "Secret1!x",
          tenantId: "wrong-tenant",
        })
      ).rejects.toThrow("Invalid email or password");
    });
  });

  describe("refresh", () => {
    it("returns new token pair from valid refresh token", async () => {
      const { refreshToken } = await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      const result = await service.refresh(refreshToken);
      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
    });

    it("rejects invalid refresh token", async () => {
      await expect(service.refresh("garbage-token")).rejects.toThrow(
        "Invalid or expired token"
      );
    });

    it("rejects access token used as refresh token", async () => {
      const { accessToken } = await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      await expect(service.refresh(accessToken)).rejects.toThrow(
        "Invalid or expired token"
      );
    });
  });

  describe("authenticate", () => {
    it("returns user from valid access token", async () => {
      const { accessToken } = await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      const user = await service.authenticate(accessToken);
      expect(user.email).toBe("test@example.com");
    });

    it("rejects refresh token used as access token", async () => {
      const { refreshToken } = await service.register({
        email: "test@example.com",
        password: "Secret1!x",
        name: "Test",
        role: "client",
        tenantId: "t1",
      });

      await expect(service.authenticate(refreshToken)).rejects.toThrow(
        "Invalid or expired token"
      );
    });
  });

  describe("authorize", () => {
    it("allows user with correct role", () => {
      const check = service.authorize("owner", "employee");
      expect(() =>
        check({ id: "1", email: "a@b.com", name: "A", role: "owner", tenantId: "t1" })
      ).not.toThrow();
    });

    it("rejects user with wrong role", () => {
      const check = service.authorize("owner");
      expect(() =>
        check({ id: "1", email: "a@b.com", name: "A", role: "client", tenantId: "t1" })
      ).toThrow("Insufficient permissions");
    });
  });
});
