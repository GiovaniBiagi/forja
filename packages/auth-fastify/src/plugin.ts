import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type AuthService, type RateLimiter, AuthError, Errors } from "@forja/auth";
import { ZodError } from "zod";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: Record<string, unknown>;
  }
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
 * Fastify plugin that registers auth routes and handles AuthError/ZodError responses.
 * Routes: POST /register, /login, /refresh, /logout, /request-password-reset, /reset-password, /verify-email, /resend-verification. GET /me.
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
  } = options;
  const { schemas } = service;

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

    return reply.status(201).send(result);
  });

  // POST /login
  const loginOpts = rateLimit("login") ? { preHandler: rateLimit("login") } : {};
  fastify.post("/login", loginOpts, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    const result = await service.login({ ...body, tenantId } as { email: string; password: string; tenantId: string });

    return reply.status(200).send(result);
  });

  // POST /refresh
  fastify.post("/refresh", async (request: FastifyRequest, reply: FastifyReply) => {
    const { refreshToken } = schemas.RefreshInput.parse(request.body);
    const result = await service.refresh(refreshToken);

    return reply.status(200).send(result);
  });

  // GET /me
  fastify.get("/me", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearerToken(request);
    const user = await service.authenticate(token);

    return reply.status(200).send(user);
  });

  // POST /logout
  fastify.post("/logout", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearerToken(request);
    await service.logout(token);

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
 * Fastify preHandler that authenticates the request via Bearer token and populates `request.authUser`.
 * @param service - The auth service instance.
 * @returns Fastify preHandler function.
 */
export function authenticate(service: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = extractBearerToken(request);
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
 * @param roles - Allowed roles for this route.
 * @returns Fastify preHandler function.
 */
export function requireRole(service: AuthService, ...roles: string[]) {
  const checkRole = service.authorize(...roles);

  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const token = extractBearerToken(request);
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

function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header", "INVALID_TOKEN", 401);
  }
  return header.slice(7);
}
