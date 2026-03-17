# @forja/scheduling-prisma

Prisma storage adapter for `@forja/scheduling`. Implements `SchedulingStorage` and `AvailabilityStorage` interfaces using Prisma model delegates, so you can plug a Prisma-backed database into the scheduling service with zero custom SQL.

## Installation

```bash
pnpm add @forja/scheduling-prisma
```

Peer dependencies: `@forja/scheduling`.

## Required Prisma Schema

The adapter expects two Prisma models. The exact model names can vary -- what matters is that the delegate you pass has the correct field structure.

```prisma
model ScheduledEvent {
  id              String   @id @default(cuid())
  tenantId        String
  contextId       String
  participants    String   // JSON-serialized Participant[]
  scheduledAt     DateTime
  durationMinutes Int
  venue           String?  // JSON-serialized Venue | null
  status          String   @default("SCHEDULED")
  metadata        String   // JSON-serialized TMeta
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([tenantId])
  @@index([tenantId, contextId])
  @@index([tenantId, status])
  @@index([scheduledAt])
}

model AvailabilityWindow {
  id              String @id @default(cuid())
  participantId   String
  participantType String
  tenantId        String
  dayOfWeek       Int
  startTime       String // "HH:MM"
  endTime         String // "HH:MM"

  @@unique([participantId, tenantId, dayOfWeek])
}
```

**Important:** `participants`, `venue`, and `metadata` are stored as JSON strings in the database. The adapter handles serialization/deserialization transparently.

## Creating Storage Adapters

### Event Storage

```ts
import { createPrismaSchedulingStorage } from "@forja/scheduling-prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const storage = createPrismaSchedulingStorage(prisma.scheduledEvent);
```

### Availability Storage

```ts
import { createPrismaAvailabilityStorage } from "@forja/scheduling-prisma";

const availabilityStorage = createPrismaAvailabilityStorage(prisma.availabilityWindow);
```

## Duck-Typed Delegates

The adapter does not import or depend on `@prisma/client` directly. Instead, it defines minimal delegate interfaces (`PrismaScheduledEventDelegate` and `PrismaAvailabilityDelegate`) that describe the shape of the Prisma model methods it uses.

This means:
- No version coupling with your Prisma client.
- Any object that satisfies the delegate interface works (useful for testing with mocks).
- You pass `prisma.scheduledEvent` (or whatever your model is named) and the adapter uses `create`, `findFirst`, `findMany`, `update`, `delete`.

### PrismaScheduledEventDelegate

```ts
interface PrismaScheduledEventDelegate {
  create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  findFirst(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<Record<string, unknown>[]>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
}
```

### PrismaAvailabilityDelegate

```ts
interface PrismaAvailabilityDelegate {
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  findMany(args: { where: Record<string, unknown> }): Promise<Record<string, unknown>[]>;
  delete(args: { where: Record<string, unknown> }): Promise<unknown>;
}
```

## JSON Serialization

Since Prisma stores `participants`, `venue`, and `metadata` as `String` columns:

**On write:** The adapter calls `JSON.stringify()` before persisting:
- `participants` -> `JSON.stringify(input.participants)`
- `venue` -> `input.venue ? JSON.stringify(input.venue) : null`
- `metadata` -> `JSON.stringify(input.metadata)`

**On read:** The adapter detects whether the value is already parsed (some Prisma setups auto-parse JSON) or still a string, and parses accordingly:
- If `typeof value === "string"` -> `JSON.parse(value)`
- Otherwise -> use as-is

This makes the adapter work with both standard string columns and Prisma's JSON column type.

## Overlap Detection: Two-Pass Strategy

The `findOverlappingEvents` method uses a two-pass approach because participants are stored as a JSON string and cannot be queried efficiently with SQL.

### Pass 1: SQL Coarse Filter

Fetches a broad set of candidate events using SQL-filterable fields:

```sql
WHERE tenantId = ?
  AND status NOT IN ('FINISHED', 'CANCELLED')
  AND scheduledAt < :endsAt
  AND scheduledAt > :startsAt - 24h   -- conservative lower bound
  AND id != :excludeEventId            -- if updating
```

The 24-hour lookback ensures events with long durations that started before `startsAt` but extend into the window are not missed.

### Pass 2: JavaScript Precise Filter

Iterates over the candidate events and checks:

1. **Time overlap:** `event.scheduledAt < endsAt && computeEndTime(event) > startsAt`
2. **Participant match:** at least one participant ID in the event matches the requested participant IDs.

Only events passing both checks are returned as conflicts.

## Listing with participantId Filter

The `listEvents` method applies most filters in SQL, but `participantId` is filtered in JavaScript post-query since participants are stored as a JSON string. The SQL query fetches all events matching the other filters (tenantId, contextId, status, date range), ordered by `scheduledAt ASC`, then the adapter filters by participant ID in memory.

## Full Integration Example

```ts
import { createSchedulingService } from "@forja/scheduling";
import {
  createPrismaSchedulingStorage,
  createPrismaAvailabilityStorage,
} from "@forja/scheduling-prisma";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();

// Define domain metadata
const matchMetadata = z.object({
  round: z.number().int().positive(),
  group: z.string().optional(),
});

// Create storage adapters
const storage = createPrismaSchedulingStorage(prisma.scheduledEvent);
const availabilityStorage = createPrismaAvailabilityStorage(prisma.availabilityWindow);

// Create service
const scheduling = createSchedulingService({
  storage,
  metadataSchema: matchMetadata,
  availability: {
    storage: availabilityStorage,
    defaultSlotDuration: 60,
  },
});

// Use it
const match = await scheduling.scheduleEvent({
  tenantId: "org-1",
  contextId: "championship-2026",
  participants: [
    { id: "team-a", label: "Team Alpha", type: "team" },
    { id: "team-b", label: "Team Beta", type: "team" },
  ],
  scheduledAt: new Date("2026-04-01T14:00:00Z"),
  durationMinutes: 90,
  venue: { id: "court-1", label: "Main Court", type: "court" },
  metadata: { round: 1 },
});
```

## Exports

```ts
export {
  createPrismaSchedulingStorage,
  createPrismaAvailabilityStorage,
} from "@forja/scheduling-prisma";

export type {
  PrismaScheduledEventDelegate,
  PrismaAvailabilityDelegate,
} from "@forja/scheduling-prisma";
```
