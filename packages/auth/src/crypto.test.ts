import { describe, it, expect } from "vitest";
import { generateOpaqueToken, hashToken } from "./crypto.js";

describe("crypto", () => {
  describe("generateOpaqueToken", () => {
    it("generates a 64-char hex string by default", () => {
      const token = generateOpaqueToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[a-f0-9]+$/);
    });

    it("generates different tokens each time", () => {
      const t1 = generateOpaqueToken();
      const t2 = generateOpaqueToken();
      expect(t1).not.toBe(t2);
    });

    it("respects custom byte length", () => {
      const token = generateOpaqueToken(16);
      expect(token).toHaveLength(32);
    });
  });

  describe("hashToken", () => {
    it("produces a consistent hash", () => {
      const hash1 = hashToken("my-token");
      const hash2 = hashToken("my-token");
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = hashToken("token-a");
      const hash2 = hashToken("token-b");
      expect(hash1).not.toBe(hash2);
    });

    it("returns a 64-char hex string (SHA-256)", () => {
      const hash = hashToken("any-input");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });
});
