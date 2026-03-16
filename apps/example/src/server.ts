import { z } from "zod";
import Fastify from "fastify";
import { createAuthService } from "@forja/auth";
import type { AuthStorage, StoredUser, PublicUser, CreateUserInput } from "@forja/auth";
import { authPlugin, authenticate, requireRole } from "@forja/auth-fastify";

// Define your own roles per project
const Role = z.enum(["owner", "barber", "client"]);

// In-memory storage for testing (replace with Prisma in a real app)
const users: StoredUser[] = [];

const storage: AuthStorage = {
  async findUserByEmail(email, tenantId) {
    return users.find((u) => u.email === email && u.tenantId === tenantId) ?? null;
  },
  async createUser(input: CreateUserInput): Promise<PublicUser> {
    const user: StoredUser = {
      id: crypto.randomUUID(),
      email: input.email,
      name: input.name,
      role: input.role,
      tenantId: input.tenantId,
      passwordHash: input.passwordHash,
    };
    users.push(user);
    return { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
  },
  async findUserById(id, tenantId) {
    const user = users.find((u) => u.id === id && u.tenantId === tenantId);
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role, tenantId: user.tenantId };
  },
};

const authService = createAuthService({
  storage,
  tokens: { secret: "dev-secret-change-me-in-production-please" },
  roles: Role,
  defaultRole: "client",
});

const app = Fastify({ logger: true });

// Register auth routes at /auth/*
app.register(authPlugin, { service: authService, prefix: "/auth" });

// Any authenticated user can access this
app.get(
  "/protected",
  { preHandler: authenticate(authService) },
  async (request) => {
    return { message: "You are authenticated!", user: request.authUser };
  }
);

// Only owners can access this
app.get(
  "/admin",
  { preHandler: requireRole(authService, "owner") },
  async (request) => {
    return { message: "Welcome, owner!", user: request.authUser };
  }
);

// Owners and barbers can access this
app.get(
  "/dashboard",
  { preHandler: requireRole(authService, "owner", "barber") },
  async (request) => {
    return { message: "Welcome to the dashboard!", user: request.authUser };
  }
);

app.listen({ port: 3000 }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
