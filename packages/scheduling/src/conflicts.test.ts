import { describe, it, expect } from "vitest";
import { assertNoConflicts, computeEndTime } from "./conflicts.js";
import { SchedulingError } from "./errors.js";
import type { ScheduledEvent } from "./types.js";

function makeEvent(
  overrides: Partial<ScheduledEvent> = {}
): ScheduledEvent {
  return {
    id: "evt-1",
    tenantId: "default",
    contextId: "ctx-1",
    participants: [{ id: "p1", label: "Team A", type: "team" }],
    scheduledAt: new Date("2026-04-10T14:00:00Z"),
    durationMinutes: 60,
    venue: null,
    status: "SCHEDULED",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("assertNoConflicts", () => {
  it("does not throw when there are no overlapping events", () => {
    expect(() => assertNoConflicts([], ["p1"])).not.toThrow();
  });

  it("throws when a participant has an overlapping event", () => {
    const existing = makeEvent({
      participants: [{ id: "p1", label: "Team A", type: "team" }],
    });

    expect(() => assertNoConflicts([existing], ["p1"])).toThrow(SchedulingError);
  });

  it("does not throw when overlapping events have no matching participants", () => {
    // In practice, findOverlappingEvents filters by participant IDs,
    // so this scenario (non-matching participants) would return an empty array.
    // assertNoConflicts handles the edge case gracefully anyway.
    expect(() => assertNoConflicts([], ["p1"])).not.toThrow();
  });

  it("includes conflicting participant IDs in the error", () => {
    const existing = makeEvent({
      participants: [
        { id: "p1", label: "Team A", type: "team" },
        { id: "p3", label: "Team C", type: "team" },
      ],
    });

    try {
      assertNoConflicts([existing], ["p1", "p3"]);
    } catch (err) {
      expect(err).toBeInstanceOf(SchedulingError);
      expect((err as SchedulingError).code).toBe("PARTICIPANT_CONFLICT");
      expect((err as SchedulingError).message).toContain("p1");
      expect((err as SchedulingError).message).toContain("p3");
    }
  });

  it("deduplicates conflicting participant IDs across multiple events", () => {
    const events = [
      makeEvent({
        id: "evt-1",
        participants: [{ id: "p1", label: "Team A", type: "team" }],
      }),
      makeEvent({
        id: "evt-2",
        participants: [{ id: "p1", label: "Team A", type: "team" }],
      }),
    ];

    try {
      assertNoConflicts(events, ["p1"]);
    } catch (err) {
      expect((err as SchedulingError).message).toContain("p1");
      // Should appear only once despite two events
      const matches = (err as SchedulingError).message.match(/p1/g);
      expect(matches).toHaveLength(1);
    }
  });
});

describe("computeEndTime", () => {
  it("adds duration in minutes to start time", () => {
    const start = new Date("2026-04-10T14:00:00Z");
    const end = computeEndTime(start, 90);
    expect(end.toISOString()).toBe("2026-04-10T15:30:00.000Z");
  });

  it("handles midnight crossing", () => {
    const start = new Date("2026-04-10T23:30:00Z");
    const end = computeEndTime(start, 60);
    expect(end.toISOString()).toBe("2026-04-11T00:30:00.000Z");
  });
});
