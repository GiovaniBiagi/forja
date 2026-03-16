import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPrismaAuthStorage } from "./adapter.js";
import type { PrismaUserDelegate } from "./adapter.js";

function createMockPrismaUser(): PrismaUserDelegate {
  const store: Record<string, unknown>[] = [];

  return {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return store.find((u) => {
        return Object.entries(where).every(([key, val]) => u[key] === val);
      }) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const user = { id: crypto.randomUUID(), ...data };
      store.push(user);
      return user;
    }),
  };
}

describe("createPrismaAuthStorage", () => {
  let mockUser: PrismaUserDelegate;
  let storage: ReturnType<typeof createPrismaAuthStorage>;

  beforeEach(() => {
    mockUser = createMockPrismaUser();
    storage = createPrismaAuthStorage(mockUser);
  });

  describe("createUser", () => {
    it("creates a user and returns public fields", async () => {
      const result = await storage.createUser({
        email: "test@example.com",
        name: "Test",
        role: "client",
        tenantId: "t1",
        passwordHash: "hashed",
      });

      expect(result.id).toBeTruthy();
      expect(result.email).toBe("test@example.com");
      expect(result.name).toBe("Test");
      expect(result.role).toBe("client");
      expect(result.tenantId).toBe("t1");
      expect(result).not.toHaveProperty("passwordHash");
    });

    it("calls prisma.create with correct data", async () => {
      await storage.createUser({
        email: "test@example.com",
        name: "Test",
        role: "owner",
        tenantId: "t1",
        passwordHash: "hashed",
      });

      expect(mockUser.create).toHaveBeenCalledWith({
        data: {
          email: "test@example.com",
          name: "Test",
          role: "owner",
          tenantId: "t1",
          passwordHash: "hashed",
        },
      });
    });
  });

  describe("findUserByEmail", () => {
    it("returns user when found", async () => {
      await storage.createUser({
        email: "test@example.com",
        name: "Test",
        role: "client",
        tenantId: "t1",
        passwordHash: "hashed",
      });

      const result = await storage.findUserByEmail("test@example.com", "t1");
      expect(result).not.toBeNull();
      expect(result?.email).toBe("test@example.com");
      expect(result?.tenantId).toBe("t1");
      expect(result?.passwordHash).toBe("hashed");
    });

    it("returns null when not found", async () => {
      const result = await storage.findUserByEmail("nobody@example.com", "t1");
      expect(result).toBeNull();
    });

    it("scopes by tenantId", async () => {
      await storage.createUser({
        email: "test@example.com",
        name: "Test",
        role: "client",
        tenantId: "t1",
        passwordHash: "hashed",
      });

      const result = await storage.findUserByEmail("test@example.com", "t2");
      expect(result).toBeNull();
    });
  });

  describe("findUserById", () => {
    it("returns user when found", async () => {
      const created = await storage.createUser({
        email: "test@example.com",
        name: "Test",
        role: "client",
        tenantId: "t1",
        passwordHash: "hashed",
      });

      const result = await storage.findUserById(created.id, "t1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe(created.id);
      expect(result).not.toHaveProperty("passwordHash");
    });

    it("returns null when not found", async () => {
      const result = await storage.findUserById("nonexistent", "t1");
      expect(result).toBeNull();
    });

    it("scopes by tenantId", async () => {
      const created = await storage.createUser({
        email: "test@example.com",
        name: "Test",
        role: "client",
        tenantId: "t1",
        passwordHash: "hashed",
      });

      const result = await storage.findUserById(created.id, "t2");
      expect(result).toBeNull();
    });
  });
});
