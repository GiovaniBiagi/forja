# @forjakit/scheduling

Framework-agnostic scheduling engine for any domain that needs time-based event management. Handles sports matches, service appointments, room bookings, and anything else that involves scheduling participants at specific times.

The core package contains zero framework or database dependencies. It defines the business logic, validation schemas, status lifecycle, and conflict detection. Storage and HTTP are handled by companion adapter packages.

## Installation

```bash
pnpm add @forjakit/scheduling
```

Peer dependency: `zod >= 3.24`.

## Core Concepts

### ScheduledEvent

The atomic unit of the module. Every scheduled event has:

| Field            | Type               | Description                                             |
| ---------------- | ------------------ | ------------------------------------------------------- |
| `id`             | `string`           | Unique identifier (assigned by storage layer)           |
| `tenantId`       | `string`           | Tenant isolation key                                    |
| `contextId`      | `string`           | Groups related events (e.g., championship ID, business ID) |
| `participants`   | `Participant[]`    | 1..N participants involved in the event                 |
| `scheduledAt`    | `Date`             | Start time                                              |
| `durationMinutes`| `number`           | Duration used for end-time calculation and overlap detection |
| `venue`          | `Venue \| null`    | Optional location                                       |
| `status`         | `EventStatus`      | Lifecycle state                                         |
| `metadata`       | `TMeta`            | Opaque consumer-defined data                            |
| `createdAt`      | `Date`             | Creation timestamp                                      |
| `updatedAt`      | `Date`             | Last update timestamp                                   |

### Participant

A generic participant in an event. The module never interprets the semantic -- the consumer defines what a participant means.

```ts
interface Participant {
  id: string;    // External ID from your domain (team ID, user ID, etc.)
  label: string; // Display label for listings and conflict messages
  type: string;  // Consumer-defined tag: "team", "player", "professional", "client"
}
```

### Venue

An optional location where the event takes place.

```ts
interface Venue {
  id: string;
  label: string;
  type?: string; // "court", "room", "chair", etc.
}
```

### Metadata Extension Pattern

Every consumer defines their own metadata shape via a Zod schema. The core module stores and retrieves it without inspecting it. The `TMeta` generic flows through the entire system -- service, storage, and schemas are all parameterized by it.

```ts
// Sports domain
const matchMeta = z.object({
  round: z.number().int().positive(),
  group: z.string().optional(),
});

// Appointment domain
const appointmentMeta = z.object({
  serviceType: z.string(),
  price: z.number().positive(),
  notes: z.string().optional(),
});
```

## Creating a Service

```ts
import { createSchedulingService } from "@forjakit/scheduling";
import { z } from "zod";

const metadataSchema = z.object({
  round: z.number().int().positive(),
  group: z.string().optional(),
});

const service = createSchedulingService({
  storage: myStorageAdapter, // implements SchedulingStorage<TMeta>
  metadataSchema,
  conflictDetection: { enabled: true }, // default: true
  availability: {                       // optional, for appointment use cases
    storage: myAvailabilityStorage,
    defaultSlotDuration: 30,
  },
});
```

### SchedulingServiceConfig

| Field               | Type                           | Required | Default | Description                                |
| ------------------- | ------------------------------ | -------- | ------- | ------------------------------------------ |
| `storage`           | `SchedulingStorage<TMeta>`     | Yes      | --      | Storage adapter for events                 |
| `metadataSchema`    | `ZodTypeAny`                   | Yes      | --      | Zod schema for consumer metadata           |
| `conflictDetection` | `{ enabled: boolean }`         | No       | `{ enabled: true }` | Toggle participant conflict detection |
| `availability`      | `{ storage, defaultSlotDuration? }` | No  | --      | Enables availability window management     |

## Schema Factory

`createSchedulingSchemas()` produces Zod schemas composed with your metadata schema. The service creates these internally, but you can also use them standalone for validation.

```ts
import { createSchedulingSchemas } from "@forjakit/scheduling";
import { z } from "zod";

// Sports match schemas
const schemas = createSchedulingSchemas(
  z.object({
    round: z.number().int().positive(),
    group: z.string().optional(),
  })
);

// Appointment schemas
const schemas = createSchedulingSchemas(
  z.object({
    serviceType: z.string(),
    price: z.number().positive(),
  })
);
```

### Produced Schemas

| Schema                 | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `CreateEventInput`     | Full creation payload with metadata              |
| `UpdateEventInput`     | Partial update (all fields optional)             |
| `TransitionStatusInput`| `{ status: EventStatus }`                        |
| `EventFiltersInput`    | Query filters for listing events                 |
| `AvailabilityInput`    | Availability window input                        |
| `ParticipantSchema`    | Participant validation                           |
| `VenueSchema`          | Venue validation                                 |
| `EventStatusSchema`    | Enum: SCHEDULED, IN_PROGRESS, FINISHED, CANCELLED|

## Service API

All methods validate input through Zod schemas before executing business logic.

### `scheduleEvent(input)`

Creates a new scheduled event. Runs conflict detection if enabled.

- **Params:** `CreateEventInput` -- tenantId, contextId, participants (min 1), scheduledAt, durationMinutes (default 60), venue (default null), metadata.
- **Returns:** `Promise<ScheduledEvent<TMeta>>`
- **Throws:** `SchedulingError` with code `PARTICIPANT_CONFLICT` if any participant has an overlapping event.

```ts
const event = await service.scheduleEvent({
  tenantId: "tenant-1",
  contextId: "championship-abc",
  participants: [
    { id: "team-1", label: "Eagles", type: "team" },
    { id: "team-2", label: "Hawks", type: "team" },
  ],
  scheduledAt: new Date("2026-04-01T14:00:00Z"),
  durationMinutes: 90,
  venue: { id: "court-1", label: "Main Court", type: "court" },
  metadata: { round: 1, group: "A" },
});
```

### `getEvent(id, tenantId)`

Retrieves a single event by ID within a tenant.

- **Params:** `id: string`, `tenantId: string`
- **Returns:** `Promise<ScheduledEvent<TMeta>>`
- **Throws:** `SchedulingError` with code `EVENT_NOT_FOUND` (404).

### `updateEvent(id, tenantId, input)`

Updates mutable fields of a SCHEDULED or IN_PROGRESS event. Re-runs conflict detection if scheduledAt or durationMinutes changed.

- **Params:** `id: string`, `tenantId: string`, `UpdateEventInput` -- scheduledAt?, durationMinutes?, venue?, metadata?.
- **Returns:** `Promise<ScheduledEvent<TMeta>>`
- **Throws:**
  - `EVENT_NOT_FOUND` (404) if the event does not exist.
  - `EVENT_NOT_MODIFIABLE` (409) if the event is FINISHED or CANCELLED.
  - `PARTICIPANT_CONFLICT` (409) if the new time overlaps another event (excludes the event being updated).

### `transitionStatus(id, tenantId, nextStatus)`

Transitions an event's status following the allowed lifecycle.

- **Params:** `id: string`, `tenantId: string`, `nextStatus: EventStatus`
- **Returns:** `Promise<ScheduledEvent<TMeta>>`
- **Throws:**
  - `EVENT_NOT_FOUND` (404).
  - `INVALID_TRANSITION` (409) if the transition is not allowed.

### `cancelEvent(id, tenantId)`

Convenience method that calls `transitionStatus(id, tenantId, "CANCELLED")`.

- **Returns:** `Promise<ScheduledEvent<TMeta>>`
- **Throws:** Same as `transitionStatus`.

### `deleteEvent(id, tenantId)`

Permanently deletes an event. Only SCHEDULED events can be deleted.

- **Params:** `id: string`, `tenantId: string`
- **Returns:** `Promise<void>`
- **Throws:**
  - `EVENT_NOT_FOUND` (404).
  - `EVENT_NOT_MODIFIABLE` (409) if the event is not in SCHEDULED status.

### `listEvents(filters)`

Lists events matching the given filters. All filters are AND-combined.

- **Params:** `EventFiltersInput` -- tenantId (required), contextId?, participantId?, status? (single or array), from?, to?.
- **Returns:** `Promise<ScheduledEvent<TMeta>[]>`

```ts
const events = await service.listEvents({
  tenantId: "tenant-1",
  contextId: "championship-abc",
  status: ["SCHEDULED", "IN_PROGRESS"],
  from: new Date("2026-04-01"),
  to: new Date("2026-04-30"),
});
```

### `setAvailability(input)`

Sets a recurring availability window for a participant. Upserts by (participantId, tenantId, dayOfWeek).

- **Params:** `AvailabilityInput` -- participantId, participantType, tenantId, dayOfWeek (0-6, Sunday=0), startTime ("HH:MM"), endTime ("HH:MM").
- **Returns:** `Promise<void>`
- **Throws:** `FEATURE_NOT_CONFIGURED` (500) if availability was not configured.

```ts
await service.setAvailability({
  participantId: "barber-1",
  participantType: "professional",
  tenantId: "tenant-1",
  dayOfWeek: 1, // Monday
  startTime: "09:00",
  endTime: "18:00",
});
```

### `getAvailableSlots(participantId, tenantId, date, durationMinutes?)`

Computes available time slots for a participant on a given date. Generates candidate slots from availability windows, then subtracts existing events.

- **Params:** `participantId: string`, `tenantId: string`, `date: Date`, `durationMinutes?: number` (defaults to configured default or 60).
- **Returns:** `Promise<TimeSlot[]>` -- each slot has `startsAt`, `endsAt`, `participantId`, `venueId`.
- **Throws:** `FEATURE_NOT_CONFIGURED` (500) if availability was not configured.

```ts
const slots = await service.getAvailableSlots(
  "barber-1",
  "tenant-1",
  new Date("2026-04-07"), // a Monday
  30 // 30-minute slots
);
// [{ startsAt: ..., endsAt: ..., participantId: "barber-1", venueId: null }, ...]
```

### `schemas`

The service also exposes the composed Zod schemas via `service.schemas` for external use (e.g., route validation).

## Status Lifecycle

```
SCHEDULED ──→ IN_PROGRESS ──→ FINISHED
    │              │
    └──→ CANCELLED ←┘
```

### Transition Rules

| From          | Allowed Targets              |
| ------------- | ---------------------------- |
| `SCHEDULED`   | `IN_PROGRESS`, `CANCELLED`   |
| `IN_PROGRESS` | `FINISHED`, `CANCELLED`      |
| `FINISHED`    | *(terminal -- no transitions)* |
| `CANCELLED`   | *(terminal -- no transitions)* |

All events start as `SCHEDULED`. Terminal states (`FINISHED`, `CANCELLED`) cannot be transitioned. Attempting an invalid transition throws `INVALID_TRANSITION` (409).

### Utility Functions

```ts
import { assertValidTransition, getAllowedTransitions } from "@forjakit/scheduling";

getAllowedTransitions("SCHEDULED"); // ["IN_PROGRESS", "CANCELLED"]
getAllowedTransitions("FINISHED");  // []

assertValidTransition("SCHEDULED", "IN_PROGRESS"); // OK
assertValidTransition("FINISHED", "SCHEDULED");    // throws SchedulingError
```

## Conflict Detection

When enabled (default), the service prevents scheduling overlapping events for the same participant(s).

**How it works:**

1. On `scheduleEvent` or `updateEvent` (when time changes), the service computes the event's end time: `scheduledAt + durationMinutes`.
2. It calls `storage.findOverlappingEvents()` with the tenant, participant IDs, start time, and end time.
3. If any overlapping events are returned, it identifies which participants conflict and throws `PARTICIPANT_CONFLICT`.
4. On updates, the event being updated is excluded from the overlap check via `excludeEventId`.

Only active events (not FINISHED or CANCELLED) are considered for conflicts.

**Disabling conflict detection:**

```ts
const service = createSchedulingService({
  storage,
  metadataSchema,
  conflictDetection: { enabled: false },
});
```

### Utility Functions

```ts
import { computeEndTime, assertNoConflicts } from "@forjakit/scheduling";

const end = computeEndTime(new Date("2026-04-01T14:00:00Z"), 90);
// 2026-04-01T15:30:00.000Z
```

## Availability Management

An opt-in feature for appointment-based scheduling (e.g., barbershops, clinics). Requires configuring `availability` in the service config.

**Concept:** Participants define recurring weekly availability windows (e.g., "Monday 09:00-18:00"). The service then computes open slots by subtracting existing events from those windows.

```ts
const service = createSchedulingService({
  storage,
  metadataSchema,
  availability: {
    storage: availabilityStorage, // implements AvailabilityStorage
    defaultSlotDuration: 30,      // minutes
  },
});

// Define when a professional is available
await service.setAvailability({
  participantId: "barber-1",
  participantType: "professional",
  tenantId: "tenant-1",
  dayOfWeek: 1, // Monday
  startTime: "09:00",
  endTime: "18:00",
});

// Get open 30-minute slots for a specific date
const slots = await service.getAvailableSlots("barber-1", "tenant-1", new Date("2026-04-07"));
```

### AvailabilityWindow

| Field             | Type     | Description                                  |
| ----------------- | -------- | -------------------------------------------- |
| `participantId`   | `string` | The participant this window belongs to        |
| `participantType` | `string` | Consumer-defined type tag                     |
| `tenantId`        | `string` | Tenant isolation key                          |
| `dayOfWeek`       | `number` | ISO day of week: 0 = Sunday, 6 = Saturday    |
| `startTime`       | `string` | "HH:MM" format                               |
| `endTime`         | `string` | "HH:MM" format                               |

### TimeSlot

| Field           | Type            | Description              |
| --------------- | --------------- | ------------------------ |
| `startsAt`      | `Date`          | Slot start time          |
| `endsAt`        | `Date`          | Slot end time            |
| `participantId` | `string`        | The participant           |
| `venueId`       | `string \| null`| Always `null` currently  |

## Error Handling

All business errors are thrown as `SchedulingError` instances with a machine-readable `code` and an HTTP-friendly `statusCode`.

```ts
import { SchedulingError } from "@forjakit/scheduling";

try {
  await service.scheduleEvent(input);
} catch (err) {
  if (err instanceof SchedulingError) {
    console.log(err.code);       // "PARTICIPANT_CONFLICT"
    console.log(err.statusCode); // 409
    console.log(err.message);    // "Participant(s) team-1 already have an event at ..."
  }
}
```

### Error Codes

| Code                     | HTTP Status | Thrown When                                      |
| ------------------------ | ----------- | ------------------------------------------------ |
| `EVENT_NOT_FOUND`        | 404         | Event ID does not exist in the tenant             |
| `EVENT_NOT_MODIFIABLE`   | 409         | Attempting to modify a FINISHED or CANCELLED event|
| `INVALID_TRANSITION`     | 409         | Status transition is not allowed                  |
| `PARTICIPANT_CONFLICT`   | 409         | Participant has an overlapping event              |
| `FEATURE_NOT_CONFIGURED` | 500         | Using availability without configuring it         |

### Error Factories

The `Errors` object provides factory functions for creating errors programmatically:

```ts
import { Errors } from "@forjakit/scheduling";

Errors.eventNotFound("evt-123");
Errors.eventNotModifiable("FINISHED");
Errors.invalidTransition("FINISHED", "SCHEDULED");
Errors.participantConflict(["team-1", "team-2"], new Date());
Errors.featureNotConfigured("Availability");
```

## TypeScript Generics

The `TMeta` generic parameter flows through the entire system:

```
createSchedulingSchemas(metadataSchema: TMeta)
  └→ schemas.CreateEventInput includes metadata: TMeta

createSchedulingService<TMeta>({ metadataSchema, storage })
  └→ storage: SchedulingStorage<z.infer<TMeta>>
  └→ service.scheduleEvent() → Promise<ScheduledEvent<z.infer<TMeta>>>
  └→ service.getEvent()      → Promise<ScheduledEvent<z.infer<TMeta>>>
  └→ ...
```

This means your IDE provides full autocompletion for `event.metadata.round`, `event.metadata.serviceType`, etc., based on the schema you provide.

## Storage Interface

To use the core package directly, implement the `SchedulingStorage<TMeta>` interface:

```ts
interface SchedulingStorage<TMeta> {
  createEvent(input: CreateEventInput<TMeta>): Promise<ScheduledEvent<TMeta>>;
  findEventById(id: string, tenantId: string): Promise<ScheduledEvent<TMeta> | null>;
  updateEvent(id: string, tenantId: string, input: UpdateEventInput<TMeta>): Promise<ScheduledEvent<TMeta>>;
  updateEventStatus(id: string, tenantId: string, status: EventStatus): Promise<ScheduledEvent<TMeta>>;
  deleteEvent(id: string, tenantId: string): Promise<void>;
  listEvents(filters: EventFilters): Promise<ScheduledEvent<TMeta>[]>;
  findOverlappingEvents(
    tenantId: string,
    participantIds: string[],
    startsAt: Date,
    endsAt: Date,
    excludeEventId?: string
  ): Promise<ScheduledEvent<TMeta>[]>;
}
```

For availability, implement `AvailabilityStorage`:

```ts
interface AvailabilityStorage {
  upsertAvailability(input: AvailabilityWindow): Promise<AvailabilityWindow>;
  findAvailability(participantId: string, tenantId: string): Promise<AvailabilityWindow[]>;
  deleteAvailability(participantId: string, tenantId: string, dayOfWeek: number): Promise<void>;
}
```

Or use `@forjakit/scheduling-prisma` for a ready-made Prisma implementation.

## Full Working Example

```ts
import { createSchedulingService, type SchedulingStorage } from "@forjakit/scheduling";
import { z } from "zod";

// 1. Define your metadata schema
const matchMetadata = z.object({
  round: z.number().int().positive(),
  group: z.string().optional(),
});

type MatchMeta = z.infer<typeof matchMetadata>;

// 2. Implement storage (or use @forjakit/scheduling-prisma)
const storage: SchedulingStorage<MatchMeta> = {
  // ... your implementation
};

// 3. Create the service
const scheduling = createSchedulingService({
  storage,
  metadataSchema: matchMetadata,
});

// 4. Schedule a match
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
  metadata: { round: 1, group: "A" },
});

// 5. Transition status
await scheduling.transitionStatus(match.id, "org-1", "IN_PROGRESS");
await scheduling.transitionStatus(match.id, "org-1", "FINISHED");

// 6. List upcoming matches
const upcoming = await scheduling.listEvents({
  tenantId: "org-1",
  contextId: "championship-2026",
  status: "SCHEDULED",
  from: new Date(),
});
```

## Exports

```ts
// Service
export { createSchedulingService } from "@forjakit/scheduling";
export type { SchedulingService, SchedulingServiceConfig } from "@forjakit/scheduling";

// Schemas
export { createSchedulingSchemas, EventStatusSchema } from "@forjakit/scheduling";
export type { SchedulingSchemas } from "@forjakit/scheduling";

// Transitions
export { assertValidTransition, getAllowedTransitions } from "@forjakit/scheduling";

// Conflicts
export { assertNoConflicts, computeEndTime } from "@forjakit/scheduling";

// Errors
export { SchedulingError, Errors } from "@forjakit/scheduling";

// Types
export type {
  EventStatus, Participant, Venue, ScheduledEvent,
  AvailabilityWindow, TimeSlot,
  CreateEventInput, UpdateEventInput, EventFilters,
  SchedulingStorage, AvailabilityStorage,
} from "@forjakit/scheduling";
```
