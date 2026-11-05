import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { type AuthService, createAuthService, Errors } from "@forjakit/auth";
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

describe("authPlugin session cookies on 401", () => {
  const session = { access_token: "access", refresh_token: "refresh" };

  const failingService = {
    schemas: {},
    authenticate: async () => {
      throw Errors.invalidToken();
    },
    login: async () => {
      throw Errors.invalidCredentials();
    },
    logout: async () => {
      throw Errors.invalidToken();
    },
    refresh: async () => {
      throw Errors.refreshTokenReuse();
    },
  } as unknown as AuthService;

  async function buildCookieApp() {
    const app = Fastify();
    await app.register(authPlugin, {
      service: failingService,
      prefix: "/auth",
      cookie: { enabled: true },
    });
    await app.ready();
    return app;
  }

  function clearedCookieNames(response: { cookies: { name: string; maxAge?: number }[] }) {
    return response.cookies
      .filter((responseCookie) => responseCookie.maxAge === 0)
      .map((responseCookie) => responseCookie.name)
      .sort();
  }

  it("keeps the refresh cookie when /me finds no access token, so the session can be renewed", async () => {
    const app = await buildCookieApp();
    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      cookies: { refresh_token: "refresh" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it("keeps the refresh cookie when /me receives an expired access token", async () => {
    const app = await buildCookieApp();
    const response = await app.inject({ method: "GET", url: "/auth/me", cookies: session });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it("keeps the session cookies when a login attempt fails", async () => {
    const app = await buildCookieApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      cookies: session,
      payload: { email: "user@example.com", password: "wrong" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it("clears both cookies when the refresh token is rejected", async () => {
    const app = await buildCookieApp();
    const response = await app.inject({ method: "POST", url: "/auth/refresh", cookies: session });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("REFRESH_TOKEN_REUSE");
    expect(clearedCookieNames(response)).toEqual(["access_token", "refresh_token"]);
    await app.close();
  });

  it("clears both cookies when logout fails on an expired access token", async () => {
    const app = await buildCookieApp();
    const response = await app.inject({ method: "POST", url: "/auth/logout", cookies: session });

    expect(response.statusCode).toBe(401);
    expect(clearedCookieNames(response)).toEqual(["access_token", "refresh_token"]);
    await app.close();
  });

  it("clears both cookies when logout finds no access token", async () => {
    const app = await buildCookieApp();
    const response = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { refresh_token: "refresh" },
    });

    expect(response.statusCode).toBe(401);
    expect(clearedCookieNames(response)).toEqual(["access_token", "refresh_token"]);
    await app.close();
  });
});
