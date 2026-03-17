# @forjakit/scheduling-fastify

Fastify plugin that exposes `@forjakit/scheduling` as a REST API. Registers CRUD routes for scheduled events with tenant isolation, input validation, auth guard hooks, and structured error responses.

## Installation

```bash
pnpm add @forjakit/scheduling-fastify
```

Peer dependencies: `@forjakit/scheduling`, `fastify >= 5`, `zod >= 3.24`.

## Plugin Registration

```ts
import Fastify from "fastify";
import { schedulingPlugin } from "@forjakit/scheduling-fastify";
import { createSchedulingService } from "@forjakit/scheduling";

const app = Fastify();

const service = createSchedulingService({
  storage: myStorage,
  metadataSchema: myMetadataSchema,
});

app.register(schedulingPlugin, {
  service,
  prefix: "/scheduling",
  tenantResolver: (req) => req.headers["x-tenant-id"] as string,
  guards: {
    write: async (req, reply) => { /* your auth logic */ },
    statusTransition: async (req, reply) => { /* optional, defaults to write */ },
  },
});
```

### SchedulingPluginOptions

| Option            | Type                                      | Required | Default                       | Description                               |
| ----------------- | ----------------------------------------- | -------- | ----------------------------- | ----------------------------------------- |
| `service`         | `SchedulingService<TMeta>`                | Yes      | --                            | Service instance from `createSchedulingService` |
| `prefix`          | `string`                                  | No       | `""`                          | Route prefix (e.g., `"/scheduling"`)      |
| `tenantResolver`  | `(req: FastifyRequest) => string`         | No       | Reads `x-tenant-id` header    | Extracts tenant ID from the request       |
| `guards.write`    | `(req, reply) => Promise<void>`           | No       | None (unguarded)              | Pre-handler for create, update, delete    |
| `guards.statusTransition` | `(req, reply) => Promise<void>`  | No       | Falls back to `guards.write`  | Pre-handler for status transitions        |

## Routes

All routes are relative to the configured `prefix`. Tenant ID is resolved from every request via `tenantResolver`.

| Method   | Path                    | Guard              | Description            |
| -------- | ----------------------- | ------------------ | ---------------------- |
| `POST`   | `/events`               | `write`            | Create event           |
| `GET`    | `/events`               | None               | List events            |
| `GET`    | `/events/:id`           | None               | Get event by ID        |
| `PATCH`  | `/events/:id`           | `write`            | Update event           |
| `DELETE` | `/events/:id`           | `write`            | Delete event           |
| `PATCH`  | `/events/:id/status`    | `statusTransition` | Transition status      |
| `POST`   | `/events/:id/cancel`    | `statusTransition` | Cancel event           |

### POST /events

Creates a new scheduled event.

**Request body:**

```json
{
  "contextId": "championship-2026",
  "participants": [
    { "id": "team-a", "label": "Team Alpha", "type": "team" },
    { "id": "team-b", "label": "Team Beta", "type": "team" }
  ],
  "scheduledAt": "2026-04-01T14:00:00Z",
  "durationMinutes": 90,
  "venue": { "id": "court-1", "label": "Main Court", "type": "court" },
  "metadata": { "round": 1 }
}
```

Note: `tenantId` is injected by the plugin from `tenantResolver`, not from the request body.

**Response:** `201 Created`

```json
{
  "event": {
    "id": "clx...",
    "tenantId": "org-1",
    "contextId": "championship-2026",
    "participants": [...],
    "scheduledAt": "2026-04-01T14:00:00.000Z",
    "durationMinutes": 90,
    "venue": { "id": "court-1", "label": "Main Court", "type": "court" },
    "status": "SCHEDULED",
    "metadata": { "round": 1 },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### GET /events

Lists events with optional filters via query parameters.

**Query parameters:**

| Param           | Type     | Description                                    |
| --------------- | -------- | ---------------------------------------------- |
| `contextId`     | `string` | Filter by context                              |
| `participantId` | `string` | Filter by participant                          |
| `status`        | `string` | Single status or comma-separated (e.g., `SCHEDULED,IN_PROGRESS`) |
| `from`          | `string` | ISO date string, lower bound for scheduledAt   |
| `to`            | `string` | ISO date string, upper bound for scheduledAt   |

**Response:** `200 OK`

```json
{
  "events": [...]
}
```

### GET /events/:id

Retrieves a single event.

**Response:** `200 OK`

```json
{
  "event": { ... }
}
```

### PATCH /events/:id

Updates mutable fields of a SCHEDULED or IN_PROGRESS event.

**Request body:** All fields optional.

```json
{
  "scheduledAt": "2026-04-02T14:00:00Z",
  "durationMinutes": 60,
  "venue": null,
  "metadata": { "round": 2 }
}
```

**Response:** `200 OK`

```json
{
  "event": { ... }
}
```

### DELETE /events/:id

Permanently deletes a SCHEDULED event.

**Response:** `204 No Content`

### PATCH /events/:id/status

Transitions event status following the allowed lifecycle.

**Request body:**

```json
{
  "status": "IN_PROGRESS"
}
```

**Response:** `200 OK`

```json
{
  "event": { ... }
}
```

### POST /events/:id/cancel

Convenience endpoint to cancel an event (equivalent to transitioning status to CANCELLED).

**Response:** `200 OK`

```json
{
  "event": { ... }
}
```

## Guards

Guards are Fastify pre-handler hooks injected before route handlers. Use them to enforce authentication and authorization.

```ts
app.register(schedulingPlugin, {
  service,
  guards: {
    write: async (req, reply) => {
      const token = req.headers.authorization?.replace("Bearer ", "");
      if (!token) {
        reply.status(401).send({ error: "UNAUTHORIZED" });
        return;
      }
      // Verify token, check permissions...
    },
    statusTransition: async (req, reply) => {
      // More restrictive guard for status changes, if needed
    },
  },
});
```

**Guard assignment:**

| Operation          | Guard Used                                      |
| ------------------ | ----------------------------------------------- |
| Create event       | `guards.write`                                  |
| Update event       | `guards.write`                                  |
| Delete event       | `guards.write`                                  |
| Transition status  | `guards.statusTransition` (falls back to `guards.write`) |
| Cancel event       | `guards.statusTransition` (falls back to `guards.write`) |
| List events        | None                                            |
| Get event          | None                                            |

If no guards are provided, all routes are unguarded.

## Tenant Resolution

By default, the plugin reads `x-tenant-id` from the request headers. If the header is missing, it throws a `SchedulingError` with code `TENANT_REQUIRED` (400).

Provide a custom resolver to extract the tenant ID from any source:

```ts
app.register(schedulingPlugin, {
  service,
  tenantResolver: (req) => {
    // From JWT claims
    return (req as any).user.tenantId;
  },
});
```

## Error Handling

The plugin registers a scoped Fastify error handler that converts known errors into structured JSON responses.

### SchedulingError Response

```json
{
  "error": "PARTICIPANT_CONFLICT",
  "message": "Participant(s) team-1 already have an event at 2026-04-01T14:00:00.000Z"
}
```

HTTP status codes are taken directly from the `SchedulingError.statusCode` property. See the core package documentation for the full error code table.

### ZodError Response (Validation Failures)

```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid input",
  "details": [
    { "field": "durationMinutes", "message": "Expected number, received string" },
    { "field": "participants", "message": "Array must contain at least 1 element(s)" }
  ]
}
```

HTTP status: `400`.

### Unhandled Errors

Any error that is not a `SchedulingError` or `ZodError` is re-thrown to Fastify's default error handler.

## Full Integration Example

```ts
import Fastify from "fastify";
import { createSchedulingService } from "@forjakit/scheduling";
import { createPrismaSchedulingStorage } from "@forjakit/scheduling-prisma";
import { schedulingPlugin } from "@forjakit/scheduling-fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const matchMetadata = z.object({
  round: z.number().int().positive(),
  group: z.string().optional(),
});

const service = createSchedulingService({
  storage: createPrismaSchedulingStorage(prisma.scheduledEvent),
  metadataSchema: matchMetadata,
});

app.register(schedulingPlugin, {
  service,
  prefix: "/api/scheduling",
  tenantResolver: (req) => {
    const tenantId = req.headers["x-tenant-id"] as string;
    if (!tenantId) throw new Error("Missing tenant");
    return tenantId;
  },
  guards: {
    write: async (req, reply) => {
      if (!req.headers.authorization) {
        reply.status(401).send({ error: "UNAUTHORIZED" });
      }
    },
  },
});

app.listen({ port: 3000 });
```

With this setup, the following routes are available:

```
POST   /api/scheduling/events
GET    /api/scheduling/events
GET    /api/scheduling/events/:id
PATCH  /api/scheduling/events/:id
DELETE /api/scheduling/events/:id
PATCH  /api/scheduling/events/:id/status
POST   /api/scheduling/events/:id/cancel
```

## Exports

```ts
export { schedulingPlugin } from "@forjakit/scheduling-fastify";
export type { SchedulingPluginOptions } from "@forjakit/scheduling-fastify";
```
