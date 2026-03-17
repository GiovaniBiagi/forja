import type { ScheduledEvent } from "./types.js";
import { Errors } from "./errors.js";

/**
 * Asserts that no participant conflicts exist for the proposed time window.
 * @param overlapping - Events returned by storage.findOverlappingEvents().
 * @param participantIds - The participants being scheduled.
 * @throws SchedulingError with code PARTICIPANT_CONFLICT if conflicts are found.
 */
export function assertNoConflicts(
  overlapping: ScheduledEvent[],
  participantIds: string[]
): void {
  if (overlapping.length === 0) return;

  const conflictingIds = overlapping.flatMap((e) =>
    e.participants
      .map((p) => p.id)
      .filter((id) => participantIds.includes(id))
  );

  const unique = [...new Set(conflictingIds)];

  throw Errors.participantConflict(unique, overlapping[0].scheduledAt);
}

/**
 * Calculates the end time of an event from its start and duration.
 * @param startsAt - Event start time.
 * @param durationMinutes - Event duration in minutes.
 * @returns The computed end time.
 */
export function computeEndTime(startsAt: Date, durationMinutes: number): Date {
  return new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
}
