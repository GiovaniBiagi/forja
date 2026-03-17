import { z } from "zod";

export const EventStatusSchema = z.enum([
  "SCHEDULED",
  "IN_PROGRESS",
  "FINISHED",
  "CANCELLED",
]);

const ParticipantSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.string().min(1),
});

const VenueSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.string().optional(),
});

/**
 * Factory that produces validated schemas for the scheduling service.
 * The consumer provides their metadata schema, which is composed into the base schemas.
 *
 * @param metadataSchema - Zod schema for the domain-specific metadata object.
 * @returns Object containing all scheduling-related Zod schemas.
 *
 * @example
 * // Sports match
 * const schemas = createSchedulingSchemas(z.object({
 *   round: z.number().int().positive(),
 *   group: z.string().optional(),
 * }));
 *
 * @example
 * // Service appointment
 * const schemas = createSchedulingSchemas(z.object({
 *   serviceType: z.string(),
 *   price: z.number().positive(),
 * }));
 */
export function createSchedulingSchemas<TMeta extends z.ZodTypeAny>(
  metadataSchema: TMeta
) {
  const CreateEventInput = z.object({
    tenantId: z.string().min(1),
    contextId: z.string().min(1),
    participants: z.array(ParticipantSchema).min(1),
    scheduledAt: z.coerce.date(),
    durationMinutes: z.number().int().positive().default(60),
    venue: VenueSchema.nullable().default(null),
    metadata: metadataSchema,
  });

  const UpdateEventInput = z.object({
    scheduledAt: z.coerce.date().optional(),
    durationMinutes: z.number().int().positive().optional(),
    venue: VenueSchema.nullable().optional(),
    metadata: metadataSchema.optional(),
  });

  const TransitionStatusInput = z.object({
    status: EventStatusSchema,
  });

  const EventFiltersInput = z.object({
    tenantId: z.string().min(1),
    contextId: z.string().optional(),
    participantId: z.string().optional(),
    status: z.union([EventStatusSchema, z.array(EventStatusSchema)]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  });

  const AvailabilityInput = z.object({
    participantId: z.string().min(1),
    participantType: z.string().min(1),
    tenantId: z.string().min(1),
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
  });

  return {
    CreateEventInput,
    UpdateEventInput,
    TransitionStatusInput,
    EventFiltersInput,
    AvailabilityInput,
    ParticipantSchema,
    VenueSchema,
    EventStatusSchema,
  };
}

/** Type representing the return value of createSchedulingSchemas. */
export type SchedulingSchemas<TMeta extends z.ZodTypeAny> = ReturnType<
  typeof createSchedulingSchemas<TMeta>
>;
