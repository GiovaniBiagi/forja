/** The status lifecycle for any scheduled event. */
export type EventStatus =
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "FINISHED"
  | "CANCELLED";

/**
 * A participant in an event. Could be a team, a player, a client, or a professional.
 * The module does not interpret the semantic — the consumer defines what participants mean.
 */
export interface Participant {
  /** External ID from the consumer's domain (team ID, user ID, etc.). */
  id: string;
  /** Display label for listings and conflict messages. */
  label: string;
  /** Consumer-defined type tag (e.g. "team", "player", "professional", "client"). */
  type: string;
}

/** The location where the event takes place. Optional. */
export interface Venue {
  id: string;
  label: string;
  /** Consumer-defined type tag (e.g. "court", "room", "chair"). */
  type?: string;
}

/**
 * The atomic unit of the scheduling module.
 *
 * Metadata is an opaque object whose shape is defined and validated by the consumer.
 * The core module stores and retrieves it without inspecting it.
 *
 * @typeParam TMeta - Consumer-defined metadata shape validated by a Zod schema.
 */
export interface ScheduledEvent<TMeta = Record<string, unknown>> {
  id: string;
  /** Consumer-defined tenant isolation key. */
  tenantId: string;
  /** Opaque context ID grouping related events (e.g. championship ID, business ID). */
  contextId: string;
  /** The participants involved in this event. Supports 1–N participants. */
  participants: Participant[];
  scheduledAt: Date;
  /** Duration in minutes. Used for end-time calculation and overlap detection. */
  durationMinutes: number;
  venue: Venue | null;
  status: EventStatus;
  /** Opaque consumer-defined metadata. */
  metadata: TMeta;
  createdAt: Date;
  updatedAt: Date;
}

// ── Availability types (opt-in feature) ──────────────────────────────────────

/**
 * A recurring time window in which a participant is available.
 * Used by service businesses for appointment scheduling.
 */
export interface AvailabilityWindow {
  participantId: string;
  participantType: string;
  tenantId: string;
  /** ISO day of week: 0 = Sunday, 6 = Saturday. */
  dayOfWeek: number;
  /** "HH:MM" format in the participant's local timezone context. */
  startTime: string;
  endTime: string;
}

/** A computed open time slot derived from availability windows minus existing events. */
export interface TimeSlot {
  startsAt: Date;
  endsAt: Date;
  participantId: string;
  venueId: string | null;
}

// ── Storage interfaces ────────────────────────────────────────────────────────

/** Input for creating a new event. Storage layer assigns id, createdAt, updatedAt. */
export interface CreateEventInput<TMeta = Record<string, unknown>> {
  tenantId: string;
  contextId: string;
  participants: Participant[];
  scheduledAt: Date;
  durationMinutes: number;
  venue: Venue | null;
  metadata: TMeta;
}

/** Input for updating an event. All fields optional. */
export interface UpdateEventInput<TMeta = Record<string, unknown>> {
  scheduledAt?: Date;
  durationMinutes?: number;
  venue?: Venue | null;
  metadata?: Partial<TMeta>;
}

/** Filters for querying events. All fields optional and AND-combined. */
export interface EventFilters {
  tenantId: string;
  contextId?: string;
  participantId?: string;
  status?: EventStatus | EventStatus[];
  from?: Date;
  to?: Date;
}

/**
 * Primary storage interface for scheduled events.
 * Consumers implement this directly or use the Prisma adapter.
 */
export interface SchedulingStorage<TMeta = Record<string, unknown>> {
  /** Creates a new event. */
  createEvent(
    input: CreateEventInput<TMeta>
  ): Promise<ScheduledEvent<TMeta>>;

  /** Finds an event by ID within a tenant. */
  findEventById(
    id: string,
    tenantId: string
  ): Promise<ScheduledEvent<TMeta> | null>;

  /** Updates an event's mutable fields. */
  updateEvent(
    id: string,
    tenantId: string,
    input: UpdateEventInput<TMeta>
  ): Promise<ScheduledEvent<TMeta>>;

  /** Updates only the event's status. */
  updateEventStatus(
    id: string,
    tenantId: string,
    status: EventStatus
  ): Promise<ScheduledEvent<TMeta>>;

  /** Permanently deletes an event. */
  deleteEvent(id: string, tenantId: string): Promise<void>;

  /** Lists events matching the given filters. */
  listEvents(filters: EventFilters): Promise<ScheduledEvent<TMeta>[]>;

  /**
   * Returns events that overlap the given time window for any of the given participant IDs.
   * Used exclusively for conflict detection.
   * @param excludeEventId - Optional event ID to exclude (for update conflict checks).
   */
  findOverlappingEvents(
    tenantId: string,
    participantIds: string[],
    startsAt: Date,
    endsAt: Date,
    excludeEventId?: string
  ): Promise<ScheduledEvent<TMeta>[]>;
}

/** Optional storage interface for availability windows. Only needed for appointment scheduling. */
export interface AvailabilityStorage {
  upsertAvailability(input: AvailabilityWindow): Promise<AvailabilityWindow>;
  findAvailability(
    participantId: string,
    tenantId: string
  ): Promise<AvailabilityWindow[]>;
  deleteAvailability(
    participantId: string,
    tenantId: string,
    dayOfWeek: number
  ): Promise<void>;
}
