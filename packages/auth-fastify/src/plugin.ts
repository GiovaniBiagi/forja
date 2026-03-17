import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type AuthService, type RateLimiter, AuthError, Errors } from "@forja/auth";
import { ZodError } from "zod";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: Record<string, unknown>;
  }
}

/** Cookie configuration for secure token delivery. */
export interface AuthCookieOptions {
  /** Enable cookie-based token delivery. When true, tokens are set as HttpOnly cookies instead of returned in the response body. */
  enabled: boolean;
  /** Whether to set the Secure flag (HTTPS only). Defaults to `true` in production. */
  secure?: boolean;
  /** SameSite attribute for cookies. Defaults to `"lax"`. */
  sameSite?: "strict" | "lax" | "none";
  /** Cookie domain. Defaults to the request hostname. */
  domain?: string;
  /** Cookie path. Defaults to `"/"`. */
  path?: string;
  /** Name for the access token cookie. Defaults to `"access_token"`. */
  accessTokenName?: string;
  /** Name for the refresh token cookie. Defaults to `"refresh_token"`. */
  refreshTokenName?: string;
}

/** Options for registering the auth Fastify plugin. */
export interface AuthPluginOptions {
  /** The auth service instance created via `createAuthService`. */
  service: AuthService;
  /** Custom function to extract the tenant ID from a request. Defaults to `x-tenant-id` header or subdomain. */
  tenantResolver?: (req: FastifyRequest) => string;
  /** Route prefix (e.g., "/auth"). */
  prefix?: string;
  /** Optional rate limiter. Applied to login, register, and password reset routes. */
  rateLimiter?: RateLimiter;
  /** Custom function to extract the rate limit key from a request. Defaults to IP address. */
  rateLimitKeyResolver?: (req: FastifyRequest) => string;
  /** Optional callback invoked with the raw reset token and user info. Use this to send the reset email. */
  onPasswordResetToken?: (token: string, user: { email: string; tenantId: string }) => Promise<void>;
  /** Optional callback invoked with the raw verification token and user info. Use this to send the verification email. */
  onVerificationToken?: (token: string, user: { email: string; tenantId: string }) => Promise<void>;
  /** Optional cookie configuration. When enabled, tokens are delivered via HttpOnly cookies instead of the response body. */
  cookie?: AuthCookieOptions;
}

function defaultTenantResolver(req: FastifyRequest): string {
  const tenantId =
    (req.headers["x-tenant-id"] as string) ??
    req.hostname.split(".")[0];

  if (!tenantId) {
    throw new AuthError("Tenant ID is required", "TENANT_REQUIRED", 400);
  }

  return tenantId;
}

function defaultRateLimitKeyResolver(req: FastifyRequest): string {
  return req.ip;
}

/**
 * Sets access and refresh token cookies on the reply.
 * @param reply - Fastify reply object.
 * @param tokens - Object containing accessToken and refreshToken strings.
 * @param cookieOpts - Resolved cookie options.
 */
function setTokenCookies(
  reply: FastifyReply,
  tokens: { accessToken: string; refreshToken: string },
  cookieOpts: Required<Pick<AuthCookieOptions, "secure" | "sameSite" | "path" | "accessTokenName" | "refreshTokenName">> & Pick<AuthCookieOptions, "domain">
) {
  const baseOpts = {
    httpOnly: true,
    secure: cookieOpts.secure,
    sameSite: cookieOpts.sameSite,
    path: cookieOpts.path,
    ...(cookieOpts.domain ? { domain: cookieOpts.domain } : {}),
  };

  reply.setCookie(cookieOpts.accessTokenName, tokens.accessToken, {
    ...baseOpts,
    maxAge: 15 * 60, // 15 minutes — matches default access token expiry
  });

  reply.setCookie(cookieOpts.refreshTokenName, tokens.refreshToken, {
    ...baseOpts,
    maxAge: 7 * 24 * 60 * 60, // 7 days — matches default refresh token expiry
  });
}

/**
 * Clears token cookies from the reply.
 * @param reply - Fastify reply object.
 * @param cookieOpts - Resolved cookie options.
 */
function clearTokenCookies(
  reply: FastifyReply,
  cookieOpts: Required<Pick<AuthCookieOptions, "path" | "accessTokenName" | "refreshTokenName">> & Pick<AuthCookieOptions, "domain">
) {
  const clearOpts = {
    httpOnly: true,
    path: cookieOpts.path,
    ...(cookieOpts.domain ? { domain: cookieOpts.domain } : {}),
    maxAge: 0,
  };

  reply.setCookie(cookieOpts.accessTokenName, "", clearOpts);
  reply.setCookie(cookieOpts.refreshTokenName, "", clearOpts);
}

/**
 * Extracts the access token from the request. Checks cookies first (if cookie mode is enabled), then falls back to the Authorization header.
 * @param request - Fastify request object.
 * @param accessTokenName - Cookie name for the access token (undefined if cookie mode is disabled).
 * @returns The raw JWT access token string.
 * @throws AuthError if no token is found.
 */
function extractToken(request: FastifyRequest, accessTokenName?: string): string {
  // Try cookie first
  if (accessTokenName) {
    const cookieToken = (request.cookies as Record<string, string | undefined>)?.[accessTokenName];
    if (cookieToken) return cookieToken;
  }

  // Fallback to Authorization header
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7);
  }

  throw new AuthError("Missing or invalid authorization header", "INVALID_TOKEN", 401);
}

/**
 * Extracts the refresh token from the request. Checks cookies first (if cookie mode is enabled), then falls back to the request body.
 * @param request - Fastify request object.
 * @param refreshTokenName - Cookie name for the refresh token (undefined if cookie mode is disabled).
 * @returns The raw JWT refresh token string, or undefined if not found in cookies.
 */
function extractRefreshToken(request: FastifyRequest, refreshTokenName?: string): string | undefined {
  if (refreshTokenName) {
    return (request.cookies as Record<string, string | undefined>)?.[refreshTokenName];
  }
  return undefined;
}

/**
 * Fastify plugin that registers auth routes and handles AuthError/ZodError responses.
 * Routes: POST /register, /login, /refresh, /logout, /request-password-reset, /reset-password, /verify-email, /resend-verification. GET /me.
 *
 * @param fastify - Fastify instance.
 * @param options - Plugin options including auth service, tenant resolver, and optional cookie configuration.
 */
export async function authPlugin(
  fastify: FastifyInstance,
  options: AuthPluginOptions
) {
  const {
    service,
    tenantResolver = defaultTenantResolver,
    rateLimiter,
    rateLimitKeyResolver = defaultRateLimitKeyResolver,
    onPasswordResetToken,
    onVerificationToken,
    cookie,
  } = options;
  const { schemas } = service;

  // Resolve cookie options
  const cookieEnabled = cookie?.enabled ?? false;
  const cookieOpts = cookieEnabled
    ? {
        secure: cookie!.secure ?? process.env.NODE_ENV === "production",
        sameSite: cookie!.sameSite ?? ("lax" as const),
        domain: cookie!.domain,
        path: cookie!.path ?? "/",
        accessTokenName: cookie!.accessTokenName ?? "access_token",
        refreshTokenName: cookie!.refreshTokenName ?? "refresh_token",
      }
    : undefined;

  // Register @fastify/cookie if cookie mode is enabled
  if (cookieEnabled) {
    await fastify.register(import("@fastify/cookie"));
  }

  // Rate limit preHandler factory
  function rateLimit(action: string) {
    if (!rateLimiter) return undefined;
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const key = rateLimitKeyResolver(request);
      const result = await rateLimiter.consume(key, action);
      if (!result.allowed) {
        if (result.retryAfter) {
          reply.header("Retry-After", String(result.retryAfter));
        }
        throw Errors.rateLimited(result.retryAfter);
      }
    };
  }

  // Error handler for AuthError and ZodError
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) {
      const response: Record<string, unknown> = { error: error.code, message: error.message };
      if (error.statusCode === 429) {
        reply.header("Retry-After", reply.getHeader("Retry-After") ?? "60");
      }
      if (cookieEnabled && error.statusCode === 401) {
        clearTokenCookies(reply, cookieOpts!);
      }
      return reply.status(error.statusCode).send(response);
    }
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: "Invalid input",
        details: error.errors.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }
    throw error;
  });

  // POST /register
  const registerOpts = rateLimit("register") ? { preHandler: rateLimit("register") } : {};
  fastify.post("/register", registerOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    const result = await service.register({ ...body, tenantId } as Parameters<typeof service.register>[0]);

    if (result.verificationToken && onVerificationToken) {
      await onVerificationToken(result.verificationToken, { email: result.user.email, tenantId });
    }

    if (cookieEnabled && cookieOpts) {
      setTokenCookies(reply, result, cookieOpts);
      const { accessToken: _, refreshToken: __, ...rest } = result;
      return reply.status(201).send(rest);
    }

    return reply.status(201).send(result);
  });

  // POST /login
  const loginOpts = rateLimit("login") ? { preHandler: rateLimit("login") } : {};
  fastify.post("/login", loginOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    const result = await service.login({ ...body, tenantId } as { email: string; password: string; tenantId: string });

    if (cookieEnabled && cookieOpts) {
      setTokenCookies(reply, result, cookieOpts);
      const { accessToken: _, refreshToken: __, ...rest } = result;
      return reply.status(200).send(rest);
    }

    return reply.status(200).send(result);
  });

  // POST /refresh
  fastify.post("/refresh", async (request: FastifyRequest, reply: FastifyReply) => {
    let refreshToken: string;

    if (cookieEnabled && cookieOpts) {
      const cookieRefresh = extractRefreshToken(request, cookieOpts.refreshTokenName);
      if (cookieRefresh) {
        refreshToken = cookieRefresh;
      } else {
        const parsed = schemas.RefreshInput.parse(request.body);
        refreshToken = parsed.refreshToken;
      }
    } else {
      const parsed = schemas.RefreshInput.parse(request.body);
      refreshToken = parsed.refreshToken;
    }

    const result = await service.refresh(refreshToken);

    if (cookieEnabled && cookieOpts) {
      setTokenCookies(reply, result, cookieOpts);
      return reply.status(200).send({ message: "Tokens refreshed" });
    }

    return reply.status(200).send(result);
  });

  // GET /me
  fastify.get("/me", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractToken(request, cookieOpts?.accessTokenName);
    const user = await service.authenticate(token);

    return reply.status(200).send(user);
  });

  // POST /logout
  fastify.post("/logout", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractToken(request, cookieOpts?.accessTokenName);
    await service.logout(token);

    if (cookieEnabled && cookieOpts) {
      clearTokenCookies(reply, cookieOpts);
    }

    return reply.status(204).send();
  });

  // POST /request-password-reset
  const resetReqOpts = rateLimit("request-password-reset") ? { preHandler: rateLimit("request-password-reset") } : {};
  fastify.post("/request-password-reset", resetReqOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    const parsed = schemas.RequestPasswordResetInput.parse({ ...body, tenantId });

    const token = await service.requestPasswordReset(parsed.email, parsed.tenantId);

    if (token && onPasswordResetToken) {
      await onPasswordResetToken(token, { email: parsed.email, tenantId });
    }

    // Always return success to avoid leaking whether the email exists
    return reply.status(200).send({ message: "If the email exists, a reset link has been sent" });
  });

  // POST /reset-password
  fastify.post("/reset-password", async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    await service.resetPassword(
      (body as { token: string }).token,
      (body as { password: string }).password,
      tenantId
    );

    return reply.status(200).send({ message: "Password has been reset" });
  });

  // POST /verify-email
  fastify.post("/verify-email", async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    const parsed = schemas.VerifyEmailInput.parse(body);
    await service.verifyEmail(parsed.token);

    return reply.status(200).send({ message: "Email verified" });
  });

  // POST /resend-verification
  fastify.post("/resend-verification", async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    const email = (body as { email: string }).email;

    const token = await service.resendVerificationEmail(email, tenantId);

    if (token && onVerificationToken) {
      await onVerificationToken(token, { email, tenantId });
    }

    return reply.status(200).send({ message: "If the email exists, a verification link has been sent" });
  });
}

// -- Middleware factories --

/**
 * Fastify preHandler that authenticates the request via Bearer token or cookie and populates `request.authUser`.
 * @param service - The auth service instance.
 * @param cookieAccessTokenName - Optional cookie name for the access token. When provided, checks cookies before the Authorization header.
 * @returns Fastify preHandler function.
 */
export function authenticate(service: AuthService, cookieAccessTokenName?: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = extractToken(request, cookieAccessTokenName);
      request.authUser = await service.authenticate(token);
    } catch (error) {
      if (error instanceof AuthError) {
        return reply
          .status(error.statusCode)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  };
}

/**
 * Fastify preHandler that authenticates and checks if the user has one of the required roles.
 * @param service - The auth service instance.
 * @param roles - Allowed roles for this route. Optionally, the first argument can be a cookie access token name if it's not a valid role.
 * @returns Fastify preHandler function.
 */
export function requireRole(service: AuthService, ...roles: string[]) {
  const checkRole = service.authorize(...roles);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = extractToken(request);
      const user = await service.authenticate(token);
      checkRole(user);
      request.authUser = user;
    } catch (error) {
      if (error instanceof AuthError) {
        return reply
          .status(error.statusCode)
          .send({ error: error.code, message: error.message });
      }
      throw error;
    }
  };
}

/**
 * Creates middleware factories that are pre-configured with cookie support.
 * Use this when cookie mode is enabled to avoid passing the cookie name to every middleware call.
 * @param service - The auth service instance.
 * @param accessTokenName - Cookie name for the access token.
 * @returns Object with `authenticate` and `requireRole` middleware factories.
 */
export function createCookieMiddleware(service: AuthService, accessTokenName: string) {
  return {
    /**
     * Fastify preHandler that authenticates via cookie or Bearer token and populates `request.authUser`.
     * @returns Fastify preHandler function.
     */
    authenticate() {
      return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const token = extractToken(request, accessTokenName);
          request.authUser = await service.authenticate(token);
        } catch (error) {
          if (error instanceof AuthError) {
            return reply
              .status(error.statusCode)
              .send({ error: error.code, message: error.message });
          }
          throw error;
        }
      };
    },
    /**
     * Fastify preHandler that authenticates via cookie or Bearer token and checks if the user has one of the required roles.
     * @param roles - Allowed roles for this route.
     * @returns Fastify preHandler function.
     */
    requireRole(...roles: string[]) {
      const checkRole = service.authorize(...roles);

      return async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          const token = extractToken(request, accessTokenName);
          const user = await service.authenticate(token);
          checkRole(user);
          request.authUser = user;
        } catch (error) {
          if (error instanceof AuthError) {
            return reply
              .status(error.statusCode)
              .send({ error: error.code, message: error.message });
          }
          throw error;
        }
      };
    },
  };
}
