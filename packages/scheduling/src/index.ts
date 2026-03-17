export { createSchedulingService } from "./service.js";
export type {
  SchedulingService,
  SchedulingServiceConfig,
} from "./service.js";

export { createSchedulingSchemas } from "./schemas.js";
export { EventStatusSchema } from "./schemas.js";
export type { SchedulingSchemas } from "./schemas.js";

export { assertValidTransition, getAllowedTransitions } from "./transitions.js";
export { assertNoConflicts, computeEndTime } from "./conflicts.js";

export { SchedulingError, Errors } from "./errors.js";

export type {
  EventStatus,
  Participant,
  Venue,
  ScheduledEvent,
  AvailabilityWindow,
  TimeSlot,
  CreateEventInput,
  UpdateEventInput,
  EventFilters,
  SchedulingStorage,
  AvailabilityStorage,
} from "./types.js";
