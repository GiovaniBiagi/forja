/** Error class for scheduling-related failures. */
export class SchedulingError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "SchedulingError";
  }
}

/** Catalog of scheduling error factories. */
export const Errors = {
  eventNotFound: (id: string) =>
    new SchedulingError(`Event ${id} not found`, "EVENT_NOT_FOUND", 404),

  eventNotModifiable: (status: string) =>
    new SchedulingError(
      `Cannot modify a ${status} event`,
      "EVENT_NOT_MODIFIABLE",
      409
    ),

  invalidTransition: (from: string, to: string) =>
    new SchedulingError(
      `Cannot transition from ${from} to ${to}`,
      "INVALID_TRANSITION",
      409
    ),

  participantConflict: (participantIds: string[], at: Date) =>
    new SchedulingError(
      `Participant(s) ${participantIds.join(", ")} already have an event at ${at.toISOString()}`,
      "PARTICIPANT_CONFLICT",
      409
    ),

  featureNotConfigured: (feature: string) =>
    new SchedulingError(
      `${feature} requires additional configuration`,
      "FEATURE_NOT_CONFIGURED",
      500
    ),
} as const;
