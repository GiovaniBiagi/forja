import type { EventStatus } from "./types.js";
import { Errors } from "./errors.js";

/**
 * Valid status transitions. The module enforces a linear lifecycle:
 * SCHEDULED → IN_PROGRESS → FINISHED
 * SCHEDULED → CANCELLED
 * IN_PROGRESS → CANCELLED
 * Terminal states (FINISHED, CANCELLED) have no outgoing transitions.
 */
const TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["FINISHED", "CANCELLED"],
  FINISHED: [],
  CANCELLED: [],
};

/**
 * Validates that a status transition is legal. Throws SchedulingError if not.
 * @param current - The current event status.
 * @param next - The desired next status.
 * @throws SchedulingError with code INVALID_TRANSITION.
 */
export function assertValidTransition(
  current: EventStatus,
  next: EventStatus
): void {
  const allowed = TRANSITIONS[current];
  if (!allowed.includes(next)) {
    throw Errors.invalidTransition(current, next);
  }
}

/**
 * Returns the list of valid next statuses from the current status.
 * @param current - The current event status.
 * @returns Array of valid next statuses.
 */
export function getAllowedTransitions(current: EventStatus): EventStatus[] {
  return TRANSITIONS[current];
}
