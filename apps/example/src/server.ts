import { z } from "zod";
import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";
import { createAuthService } from "@forja/auth";
import { authPlugin, authenticate, requireRole } from "@forja/auth-fastify";
import { createPrismaAuthStorage } from "@forja/auth-prisma";

// Define your own roles per project
const Role = z.enum(["owner", "barber", "client"]);

// Prisma + SQLite — data persists across restarts
const prisma = new PrismaClient();
const storage = createPrismaAuthStorage(prisma.user);

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
