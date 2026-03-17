import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { type SchedulingService, SchedulingError } from "@forja/scheduling";
import { ZodError, type ZodTypeAny } from "zod";

/** Options for registering the scheduling Fastify plugin. */
export interface SchedulingPluginOptions<TMeta extends ZodTypeAny> {
  /** The scheduling service instance created via `createSchedulingService`. */
  service: SchedulingService<TMeta>;
  /** Route prefix (e.g., "/scheduling"). */
  prefix?: string;
  /** Resolves tenantId from the request. Defaults to `x-tenant-id` header. */
  tenantResolver?: (req: FastifyRequest) => string;
  /**
   * Guards for operations. Inject your auth middleware here.
   * Read operations (list, get) are unguarded by default.
   */
  guards?: {
    /** Guard for create, update, delete operations. */
    write?: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Guard for status transitions. Defaults to the write guard if not set. */
    statusTransition?: (
      req: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>;
  };
}

function defaultTenantResolver(req: FastifyRequest): string {
  const id = req.headers["x-tenant-id"] as string;
  if (!id) {
    throw new SchedulingError(
      "Tenant ID is required",
      "TENANT_REQUIRED",
      400
    );
  }
  return id;
}

/**
 * Fastify plugin that registers scheduling CRUD routes.
 *
 * Routes:
 * - POST   /events          — create event
 * - GET    /events          — list events (query: contextId, participantId, status, from, to)
 * - GET    /events/:id      — get event
 * - PATCH  /events/:id      — update event
 * - DELETE /events/:id      — delete event
 * - PATCH  /events/:id/status — transition status
 * - POST   /events/:id/cancel — cancel event
 *
 * @param fastify - Fastify instance.
 * @param options - Plugin options.
 */
export async function schedulingPlugin<TMeta extends ZodTypeAny>(
  fastify: FastifyInstance,
  options: SchedulingPluginOptions<TMeta>
) {
  const {
    service,
    tenantResolver = defaultTenantResolver,
    guards,
  } = options;

  const writeGuard = guards?.write;
  const statusGuard = guards?.statusTransition ?? writeGuard;

  // Error handler for SchedulingError and ZodError
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof SchedulingError) {
      return reply
        .status(error.statusCode)
        .send({ error: error.code, message: error.message });
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

  // POST /events — create
  const createOpts = writeGuard ? { preHandler: writeGuard } : {};
  fastify.post("/events", createOpts, async (request, reply) => {
    const tenantId = tenantResolver(request);
    const body = request.body as Record<string, unknown>;

    const event = await service.scheduleEvent({
      ...body,
      tenantId,
    } as unknown as Parameters<typeof service.scheduleEvent>[0]);

    return reply.status(201).send({ event });
  });

  // GET /events — list
  fastify.get("/events", async (request) => {
    const tenantId = tenantResolver(request);
    const query = request.query as Record<string, string | undefined>;

    const filters: Record<string, unknown> = { tenantId };
    if (query.contextId) filters.contextId = query.contextId;
    if (query.participantId) filters.participantId = query.participantId;
    if (query.status) {
      filters.status = query.status.includes(",")
        ? query.status.split(",")
        : query.status;
    }
    if (query.from) filters.from = query.from;
    if (query.to) filters.to = query.to;

    const events = await service.listEvents(
      filters as Parameters<typeof service.listEvents>[0]
    );
    return { events };
  });

  // GET /events/:id — get
  fastify.get("/events/:id", async (request) => {
    const tenantId = tenantResolver(request);
    const { id } = request.params as { id: string };

    const event = await service.getEvent(id, tenantId);
    return { event };
  });

  // PATCH /events/:id — update
  const updateOpts = writeGuard ? { preHandler: writeGuard } : {};
  fastify.patch("/events/:id", updateOpts, async (request) => {
    const tenantId = tenantResolver(request);
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const event = await service.updateEvent(id, tenantId, body as Parameters<typeof service.updateEvent>[2]);
    return { event };
  });

  // DELETE /events/:id — delete
  const deleteOpts = writeGuard ? { preHandler: writeGuard } : {};
  fastify.delete("/events/:id", deleteOpts, async (request, reply) => {
    const tenantId = tenantResolver(request);
    const { id } = request.params as { id: string };

    await service.deleteEvent(id, tenantId);
    return reply.status(204).send();
  });

  // PATCH /events/:id/status — transition
  const statusOpts = statusGuard ? { preHandler: statusGuard } : {};
  fastify.patch("/events/:id/status", statusOpts, async (request) => {
    const tenantId = tenantResolver(request);
    const { id } = request.params as { id: string };
    const { status } = request.body as { status: string };

    const event = await service.transitionStatus(id, tenantId, status);
    return { event };
  });

  // POST /events/:id/cancel — convenience
  const cancelOpts = statusGuard ? { preHandler: statusGuard } : {};
  fastify.post("/events/:id/cancel", cancelOpts, async (request) => {
    const tenantId = tenantResolver(request);
    const { id } = request.params as { id: string };

    const event = await service.cancelEvent(id, tenantId);
    return { event };
  });
}
