import { z } from "zod";
import type {
  SchedulingStorage,
  AvailabilityStorage,
  ScheduledEvent,
  CreateEventInput,
  UpdateEventInput,
  TimeSlot,
} from "./types.js";
import { createSchedulingSchemas } from "./schemas.js";
import { assertValidTransition } from "./transitions.js";
import { assertNoConflicts, computeEndTime } from "./conflicts.js";
import { Errors } from "./errors.js";

/** Configuration for creating a scheduling service. */
export interface SchedulingServiceConfig<TMeta extends z.ZodTypeAny> {
  /** Storage adapter for scheduled events. */
  storage: SchedulingStorage<z.infer<TMeta>>;
  /** Zod schema for the consumer-defined metadata object. */
  metadataSchema: TMeta;
  /** Optional: enables availability window management (appointment use case). */
  availability?: {
    storage: AvailabilityStorage;
    /** Default slot duration in minutes when querying available slots. Defaults to 60. */
    defaultSlotDuration?: number;
  };
  /** Optional: conflict detection configuration. Enabled by default. */
  conflictDetection?: {
    enabled: boolean;
  };
}

/**
 * Creates a framework-agnostic scheduling service.
 *
 * @param config - Service configuration including storage adapter and metadata schema.
 * @returns An object with scheduling operations and the composed Zod schemas.
 *
 * @example
 * const service = createSchedulingService({
 *   storage: myStorageAdapter,
 *   metadataSchema: z.object({ round: z.number() }),
 *   conflictDetection: { enabled: true },
 * });
 */
export function createSchedulingService<TMeta extends z.ZodTypeAny>(
  config: SchedulingServiceConfig<TMeta>
) {
  type Meta = z.infer<TMeta>;

  const { storage, metadataSchema } = config;
  const conflictEnabled = config.conflictDetection?.enabled ?? true;
  const schemas = createSchedulingSchemas(metadataSchema);

  /**
   * Creates a new scheduled event.
   * @param input - Event creation input validated against the composed schema.
   * @returns The created event.
   * @throws SchedulingError with code PARTICIPANT_CONFLICT if overlap is detected.
   */
  async function scheduleEvent(
    input: z.infer<typeof schemas.CreateEventInput>
  ): Promise<ScheduledEvent<Meta>> {
    const parsed = schemas.CreateEventInput.parse(input);
    const eventInput = parsed as unknown as CreateEventInput<Meta>;

    if (conflictEnabled) {
      const endsAt = computeEndTime(eventInput.scheduledAt, eventInput.durationMinutes);
      const participantIds = eventInput.participants.map((p) => p.id);
      const overlapping = await storage.findOverlappingEvents(
        eventInput.tenantId,
        participantIds,
        eventInput.scheduledAt,
        endsAt
      );
      assertNoConflicts(overlapping, participantIds);
    }

    return storage.createEvent(eventInput);
  }

  /**
   * Retrieves an event by ID.
   * @param id - Event ID.
   * @param tenantId - Tenant isolation key.
   * @returns The event.
   * @throws SchedulingError with code EVENT_NOT_FOUND.
   */
  async function getEvent(
    id: string,
    tenantId: string
  ): Promise<ScheduledEvent<Meta>> {
    const event = await storage.findEventById(id, tenantId);
    if (!event) throw Errors.eventNotFound(id);
    return event;
  }

  /**
   * Updates a scheduled or in-progress event's mutable fields.
   * @param id - Event ID.
   * @param tenantId - Tenant isolation key.
   * @param input - Fields to update.
   * @returns The updated event.
   * @throws SchedulingError if the event is finished/cancelled or conflicts are detected.
   */
  async function updateEvent(
    id: string,
    tenantId: string,
    input: z.infer<typeof schemas.UpdateEventInput>
  ): Promise<ScheduledEvent<Meta>> {
    const parsed = schemas.UpdateEventInput.parse(input);
    const updateInput = parsed as unknown as UpdateEventInput<Meta>;

    const existing = await storage.findEventById(id, tenantId);
    if (!existing) throw Errors.eventNotFound(id);

    if (existing.status === "FINISHED" || existing.status === "CANCELLED") {
      throw Errors.eventNotModifiable(existing.status);
    }

    if (conflictEnabled && (updateInput.scheduledAt || updateInput.durationMinutes)) {
      const newStart = updateInput.scheduledAt ?? existing.scheduledAt;
      const newDuration = updateInput.durationMinutes ?? existing.durationMinutes;
      const endsAt = computeEndTime(newStart, newDuration);
      const participantIds = existing.participants.map((p) => p.id);
      const overlapping = await storage.findOverlappingEvents(
        tenantId,
        participantIds,
        newStart,
        endsAt,
        id
      );
      assertNoConflicts(overlapping, participantIds);
    }

    return storage.updateEvent(id, tenantId, updateInput);
  }

  /**
   * Transitions an event's status following the allowed lifecycle.
   * @param id - Event ID.
   * @param tenantId - Tenant isolation key.
   * @param nextStatus - The desired next status.
   * @returns The updated event.
   * @throws SchedulingError with code INVALID_TRANSITION if the transition is not allowed.
   */
  async function transitionStatus(
    id: string,
    tenantId: string,
    nextStatus: string
  ): Promise<ScheduledEvent<Meta>> {
    const { status } = schemas.TransitionStatusInput.parse({
      status: nextStatus,
    });

    const existing = await storage.findEventById(id, tenantId);
    if (!existing) throw Errors.eventNotFound(id);

    assertValidTransition(existing.status, status);

    return storage.updateEventStatus(id, tenantId, status);
  }

  /**
   * Convenience method to cancel an event.
   * @param id - Event ID.
   * @param tenantId - Tenant isolation key.
   * @returns The cancelled event.
   */
  async function cancelEvent(
    id: string,
    tenantId: string
  ): Promise<ScheduledEvent<Meta>> {
    return transitionStatus(id, tenantId, "CANCELLED");
  }

  /**
   * Permanently deletes an event. Only SCHEDULED events can be deleted.
   * @param id - Event ID.
   * @param tenantId - Tenant isolation key.
   * @throws SchedulingError if the event is not in SCHEDULED status.
   */
  async function deleteEvent(id: string, tenantId: string): Promise<void> {
    const existing = await storage.findEventById(id, tenantId);
    if (!existing) throw Errors.eventNotFound(id);

    if (existing.status !== "SCHEDULED") {
      throw Errors.eventNotModifiable(existing.status);
    }

    return storage.deleteEvent(id, tenantId);
  }

  /**
   * Lists events matching the given filters.
   * @param filters - Query filters.
   * @returns Array of matching events.
   */
  async function listEvents(
    filters: z.infer<typeof schemas.EventFiltersInput>
  ): Promise<ScheduledEvent<Meta>[]> {
    const parsed = schemas.EventFiltersInput.parse(filters);
    return storage.listEvents(parsed as unknown as import("./types.js").EventFilters);
  }

  /**
   * Sets an availability window for a participant. Upserts by (participantId, tenantId, dayOfWeek).
   * Requires the availability feature to be configured.
   * @param input - Availability window data.
   * @throws SchedulingError with code FEATURE_NOT_CONFIGURED if availability is not set up.
   */
  async function setAvailability(
    input: z.infer<typeof schemas.AvailabilityInput>
  ): Promise<void> {
    if (!config.availability)
      throw Errors.featureNotConfigured("Availability");
    const parsed = schemas.AvailabilityInput.parse(input);
    await config.availability.storage.upsertAvailability(parsed);
  }

  /**
   * Computes available time slots for a participant on a given date.
   * Subtracts existing events from the participant's availability windows.
   * @param participantId - The participant to check availability for.
   * @param tenantId - Tenant isolation key.
   * @param date - The date to check.
   * @param durationMinutes - Desired slot duration. Defaults to configured default or 60.
   * @returns Array of available time slots.
   */
  async function getAvailableSlots(
    participantId: string,
    tenantId: string,
    date: Date,
    durationMinutes?: number
  ): Promise<TimeSlot[]> {
    if (!config.availability)
      throw Errors.featureNotConfigured("Availability");

    const slotDuration =
      durationMinutes ?? config.availability.defaultSlotDuration ?? 60;

    const dayOfWeek = date.getDay();
    const windows = await config.availability.storage.findAvailability(
      participantId,
      tenantId
    );

    const todayWindows = windows.filter((w) => w.dayOfWeek === dayOfWeek);
    if (todayWindows.length === 0) return [];

    const candidates: TimeSlot[] = [];
    for (const window of todayWindows) {
      const [startH, startM] = window.startTime.split(":").map(Number);
      const [endH, endM] = window.endTime.split(":").map(Number);

      const windowStart = new Date(date);
      windowStart.setHours(startH, startM, 0, 0);

      const windowEnd = new Date(date);
      windowEnd.setHours(endH, endM, 0, 0);

      let cursor = windowStart;
      while (
        cursor.getTime() + slotDuration * 60 * 1000 <=
        windowEnd.getTime()
      ) {
        const slotEnd = new Date(cursor.getTime() + slotDuration * 60 * 1000);
        candidates.push({
          startsAt: new Date(cursor),
          endsAt: slotEnd,
          participantId,
          venueId: null,
        });
        cursor = slotEnd;
      }
    }

    if (candidates.length === 0) return [];

    const rangeStart = candidates[0].startsAt;
    const rangeEnd = candidates[candidates.length - 1].endsAt;

    const occupied = await storage.findOverlappingEvents(
      tenantId,
      [participantId],
      rangeStart,
      rangeEnd
    );

    return candidates.filter(
      (slot) =>
        !occupied.some(
          (ev) =>
            ev.scheduledAt < slot.endsAt &&
            computeEndTime(ev.scheduledAt, ev.durationMinutes) > slot.startsAt
        )
    );
  }

  return {
    scheduleEvent,
    getEvent,
    updateEvent,
    transitionStatus,
    cancelEvent,
    deleteEvent,
    listEvents,
    setAvailability,
    getAvailableSlots,
    schemas,
  };
}

/** Type representing the scheduling service instance. */
export type SchedulingService<TMeta extends z.ZodTypeAny = z.ZodTypeAny> =
  ReturnType<typeof createSchedulingService<TMeta>>;
