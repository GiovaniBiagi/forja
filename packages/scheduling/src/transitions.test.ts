import { describe, it, expect } from "vitest";
import { assertValidTransition, getAllowedTransitions } from "./transitions.js";
import { SchedulingError } from "./errors.js";

describe("assertValidTransition", () => {
  it("allows SCHEDULED → IN_PROGRESS", () => {
    expect(() => assertValidTransition("SCHEDULED", "IN_PROGRESS")).not.toThrow();
  });

  it("allows SCHEDULED → CANCELLED", () => {
    expect(() => assertValidTransition("SCHEDULED", "CANCELLED")).not.toThrow();
  });

  it("allows IN_PROGRESS → FINISHED", () => {
    expect(() => assertValidTransition("IN_PROGRESS", "FINISHED")).not.toThrow();
  });

  it("allows IN_PROGRESS → CANCELLED", () => {
    expect(() => assertValidTransition("IN_PROGRESS", "CANCELLED")).not.toThrow();
  });

  it("rejects SCHEDULED → FINISHED (must go through IN_PROGRESS)", () => {
    expect(() => assertValidTransition("SCHEDULED", "FINISHED")).toThrow(SchedulingError);
  });

  it("rejects FINISHED → any", () => {
    expect(() => assertValidTransition("FINISHED", "SCHEDULED")).toThrow(SchedulingError);
    expect(() => assertValidTransition("FINISHED", "IN_PROGRESS")).toThrow(SchedulingError);
    expect(() => assertValidTransition("FINISHED", "CANCELLED")).toThrow(SchedulingError);
  });

  it("rejects CANCELLED → any", () => {
    expect(() => assertValidTransition("CANCELLED", "SCHEDULED")).toThrow(SchedulingError);
    expect(() => assertValidTransition("CANCELLED", "IN_PROGRESS")).toThrow(SchedulingError);
    expect(() => assertValidTransition("CANCELLED", "FINISHED")).toThrow(SchedulingError);
  });

  it("throws with INVALID_TRANSITION code", () => {
    try {
      assertValidTransition("FINISHED", "SCHEDULED");
    } catch (err) {
      expect(err).toBeInstanceOf(SchedulingError);
      expect((err as SchedulingError).code).toBe("INVALID_TRANSITION");
      expect((err as SchedulingError).statusCode).toBe(409);
    }
  });
});

describe("getAllowedTransitions", () => {
  it("returns correct transitions for SCHEDULED", () => {
    expect(getAllowedTransitions("SCHEDULED")).toEqual(["IN_PROGRESS", "CANCELLED"]);
  });

  it("returns correct transitions for IN_PROGRESS", () => {
    expect(getAllowedTransitions("IN_PROGRESS")).toEqual(["FINISHED", "CANCELLED"]);
  });

  it("returns empty array for FINISHED", () => {
    expect(getAllowedTransitions("FINISHED")).toEqual([]);
  });

  it("returns empty array for CANCELLED", () => {
    expect(getAllowedTransitions("CANCELLED")).toEqual([]);
  });
});
