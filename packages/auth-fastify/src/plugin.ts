import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type AuthService, AuthError } from "@forja/auth";

declare module "fastify" {
  interface FastifyRequest {
    authUser?: Record<string, unknown>;
  }
}

export interface AuthPluginOptions {
  service: AuthService;
  tenantResolver?: (req: FastifyRequest) => string;
  prefix?: string;
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

export async function authPlugin(
  fastify: FastifyInstance,
  options: AuthPluginOptions
) {
  const { service, tenantResolver = defaultTenantResolver } = options;
  const { schemas } = service;

  // Error handler for AuthError
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    throw error;
  });

  // POST /register
  fastify.post("/register", async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;
    const result = await service.register({ ...body, tenantId } as Parameters<typeof service.register>[0]);

    return reply.status(201).send(result);
  });

  // POST /login
  fastify.post("/login", async (request: FastifyRequest, reply: FastifyReply) => {
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
}

// -- Middleware factories --

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
