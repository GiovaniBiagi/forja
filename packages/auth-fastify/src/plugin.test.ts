import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { type AuthService, createAuthService } from "@forjakit/auth";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { authenticate, authPlugin } from "./plugin.js";

const stubService = { schemas: {} } as unknown as AuthService;

async function buildApp(registration?: boolean) {
  const app = Fastify();
  await app.register(authPlugin, { service: stubService, prefix: "/auth", registration });
  await app.ready();
  return app;
}

describe("authPlugin registration option", () => {
  it("exposes POST /register by default", async () => {
    const app = await buildApp();
    expect(app.hasRoute({ method: "POST", url: "/auth/register" })).toBe(true);
    await app.close();
  });

  it("does not expose POST /register when registration is false", async () => {
    const app = await buildApp(false);
    expect(app.hasRoute({ method: "POST", url: "/auth/register" })).toBe(false);
    expect(app.hasRoute({ method: "POST", url: "/auth/login" })).toBe(true);
    await app.close();
  });
});

describe("authPlugin typing", () => {
  it("accepts a service created with a project-specific role enum", async () => {
    const service = createAuthService({
      storage: {} as never,
      tokens: { secret: "x".repeat(32) },
      roles: z.enum(["admin", "staff"]),
      defaultRole: "staff",
    });
    const app = Fastify();
    await app.register(authPlugin, { service, registration: false });
    app.get("/private", { preHandler: authenticate(service) }, async () => "ok");
    await app.ready();
    expect(app.hasRoute({ method: "GET", url: "/private" })).toBe(true);
    await app.close();
  });
});

describe("authPlugin cookie mode", () => {
  it("reuses @fastify/cookie when the app already registered it", async () => {
    const app = Fastify();
    await app.register(cookie);
    await app.register(authPlugin, { service: stubService, cookie: { enabled: true } });
    await expect(app.ready()).resolves.toBeDefined();
    await app.close();
  });
});
