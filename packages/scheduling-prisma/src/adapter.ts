import type {
  SchedulingStorage,
  AvailabilityStorage,
  ScheduledEvent,
  CreateEventInput,
  UpdateEventInput,
  EventFilters,
  EventStatus,
  Participant,
  AvailabilityWindow,
} from "@forjakit/scheduling";
import { computeEndTime } from "@forjakit/scheduling";

// ── Duck-typed Prisma delegate interfaces ─────────────────────────────────────

/** Delegate shape for the ScheduledEvent Prisma model. */
export interface PrismaScheduledEventDelegate {
  create(args: {
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
  findUnique(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null>;
  findMany(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<Record<string, unknown>[]>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  delete(args: {
    where: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Delegate shape for the AvailabilityWindow Prisma model. */
export interface PrismaAvailabilityDelegate {
  upsert(args: {
    where: Record<string, unknown>;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  findMany(args: {
    where: Record<string, unknown>;
  }): Promise<Record<string, unknown>[]>;
  delete(args: {
    where: Record<string, unknown>;
  }): Promise<unknown>;
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function toScheduledEvent<TMeta>(
  row: Record<string, unknown>
): ScheduledEvent<TMeta> {
  return {
    id: row.id as string,
    tenantId: row.tenantId as string,
    contextId: row.contextId as string,
    participants: (typeof row.participants === "string"
      ? JSON.parse(row.participants)
      : row.participants) as Participant[],
    scheduledAt: new Date(row.scheduledAt as string | Date),
    durationMinutes: row.durationMinutes as number,
    venue:
      row.venue === null || row.venue === undefined
        ? null
        : typeof row.venue === "string"
          ? JSON.parse(row.venue)
          : row.venue,
    status: row.status as EventStatus,
    metadata: (typeof row.metadata === "string"
      ? JSON.parse(row.metadata)
      : row.metadata) as TMeta,
    createdAt: new Date(row.createdAt as string | Date),
    updatedAt: new Date(row.updatedAt as string | Date),
  } as ScheduledEvent<TMeta>;
}

function toAvailabilityWindow(
  row: Record<string, unknown>
): AvailabilityWindow {
  return {
    participantId: row.participantId as string,
    participantType: row.participantType as string,
    tenantId: row.tenantId as string,
    dayOfWeek: row.dayOfWeek as number,
    startTime: row.startTime as string,
    endTime: row.endTime as string,
  };
}

// ── Storage factory ───────────────────────────────────────────────────────────

/**
 * Creates a Prisma-based storage adapter for scheduled events.
 * @param delegate - The Prisma model delegate (e.g. `prisma.scheduledEvent`).
 * @returns A SchedulingStorage implementation.
 */
export function createPrismaSchedulingStorage<TMeta = Record<string, unknown>>(
  delegate: PrismaScheduledEventDelegate
): SchedulingStorage<TMeta> {
  return {
    async createEvent(
      input: CreateEventInput<TMeta>
    ): Promise<ScheduledEvent<TMeta>> {
      const row = await delegate.create({
        data: {
          tenantId: input.tenantId,
          contextId: input.contextId,
          participants: JSON.stringify(input.participants),
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          venue: input.venue ? JSON.stringify(input.venue) : null,
          status: "SCHEDULED",
          metadata: JSON.stringify(input.metadata),
        },
      });
      return toScheduledEvent<TMeta>(row);
    },

    async findEventById(
      id: string,
      tenantId: string
    ): Promise<ScheduledEvent<TMeta> | null> {
      const row = await delegate.findFirst({
        where: { id, tenantId },
      });
      return row ? toScheduledEvent<TMeta>(row) : null;
    },

    async updateEvent(
      id: string,
      tenantId: string,
      input: UpdateEventInput<TMeta>
    ): Promise<ScheduledEvent<TMeta>> {
      const data: Record<string, unknown> = {};
      if (input.scheduledAt !== undefined) data.scheduledAt = input.scheduledAt;
      if (input.durationMinutes !== undefined)
        data.durationMinutes = input.durationMinutes;
      if (input.venue !== undefined)
        data.venue = input.venue ? JSON.stringify(input.venue) : null;
      if (input.metadata !== undefined)
        data.metadata = JSON.stringify(input.metadata);

      const row = await delegate.update({
        where: { id },
        data,
      });
      return toScheduledEvent<TMeta>(row);
    },

    async updateEventStatus(
      id: string,
      _tenantId: string,
      status: EventStatus
    ): Promise<ScheduledEvent<TMeta>> {
      const row = await delegate.update({
        where: { id },
        data: { status },
      });
      return toScheduledEvent<TMeta>(row);
    },

    async deleteEvent(id: string, _tenantId: string): Promise<void> {
      await delegate.delete({ where: { id } });
    },

    async listEvents(
      filters: EventFilters
    ): Promise<ScheduledEvent<TMeta>[]> {
      const where: Record<string, unknown> = { tenantId: filters.tenantId };

      if (filters.contextId) where.contextId = filters.contextId;
      if (filters.status) {
        where.status = Array.isArray(filters.status)
          ? { in: filters.status }
          : filters.status;
      }
      if (filters.from || filters.to) {
        const scheduledAt: Record<string, unknown> = {};
        if (filters.from) scheduledAt.gte = filters.from;
        if (filters.to) scheduledAt.lte = filters.to;
        where.scheduledAt = scheduledAt;
      }

      const rows = await delegate.findMany({
        where,
        orderBy: { scheduledAt: "asc" },
      });

      let events = rows.map((r) => toScheduledEvent<TMeta>(r));

      // Post-filter by participantId (JSON field, can't filter in SQL efficiently)
      if (filters.participantId) {
        events = events.filter((e) =>
          e.participants.some((p) => p.id === filters.participantId)
        );
      }

      return events;
    },

    async findOverlappingEvents(
      tenantId: string,
      participantIds: string[],
      startsAt: Date,
      endsAt: Date,
      excludeEventId?: string
    ): Promise<ScheduledEvent<TMeta>[]> {
      // Fetch events in a conservative time window that could overlap
      const where: Record<string, unknown> = {
        tenantId,
        status: { notIn: ["FINISHED", "CANCELLED"] },
        scheduledAt: {
          lt: endsAt,
          // Conservative lower bound: events up to 24h before could still overlap
          gt: new Date(startsAt.getTime() - 24 * 60 * 60 * 1000),
        },
      };

      if (excludeEventId) {
        where.NOT = { id: excludeEventId };
      }

      const rows = await delegate.findMany({ where });
      const events = rows.map((r) => toScheduledEvent<TMeta>(r));

      // Precise filtering: check actual end-time overlap AND participant match
      return events.filter((e) => {
        const eventEnd = computeEndTime(e.scheduledAt, e.durationMinutes);
        const timeOverlaps = e.scheduledAt < endsAt && eventEnd > startsAt;
        if (!timeOverlaps) return false;

        const hasMatchingParticipant = e.participants.some((p) =>
          participantIds.includes(p.id)
        );
        return hasMatchingParticipant;
      });
    },
  };
}

/**
 * Creates a Prisma-based storage adapter for availability windows.
 * @param delegate - The Prisma model delegate (e.g. `prisma.availabilityWindow`).
 * @returns An AvailabilityStorage implementation.
 */
export function createPrismaAvailabilityStorage(
  delegate: PrismaAvailabilityDelegate
): AvailabilityStorage {
  return {
    async upsertAvailability(
      input: AvailabilityWindow
    ): Promise<AvailabilityWindow> {
      const uniqueWhere = {
        participantId_tenantId_dayOfWeek: {
          participantId: input.participantId,
          tenantId: input.tenantId,
          dayOfWeek: input.dayOfWeek,
        },
      };

      const row = await delegate.upsert({
        where: uniqueWhere,
        create: {
          participantId: input.participantId,
          participantType: input.participantType,
          tenantId: input.tenantId,
          dayOfWeek: input.dayOfWeek,
          startTime: input.startTime,
          endTime: input.endTime,
        },
        update: {
          startTime: input.startTime,
          endTime: input.endTime,
          participantType: input.participantType,
        },
      });

      return toAvailabilityWindow(row);
    },

    async findAvailability(
      participantId: string,
      tenantId: string
    ): Promise<AvailabilityWindow[]> {
      const rows = await delegate.findMany({
        where: { participantId, tenantId },
      });
      return rows.map(toAvailabilityWindow);
    },

    async deleteAvailability(
      participantId: string,
      tenantId: string,
      dayOfWeek: number
    ): Promise<void> {
      await delegate.delete({
        where: {
          participantId_tenantId_dayOfWeek: {
            participantId,
            tenantId,
            dayOfWeek,
          },
        },
      });
    },
  };
}
