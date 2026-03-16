import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes and verifies correctly", async () => {
    const hash = await hashPassword("MyPassword1!");
    expect(hash).not.toBe("MyPassword1!");
    expect(await verifyPassword(hash, "MyPassword1!")).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("MyPassword1!");
    expect(await verifyPassword(hash, "WrongPassword1!")).toBe(false);
  });

  it("produces different hashes for same password", async () => {
    const hash1 = await hashPassword("MyPassword1!");
    const hash2 = await hashPassword("MyPassword1!");
    expect(hash1).not.toBe(hash2);
  });
});
