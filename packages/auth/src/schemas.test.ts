import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createAuthSchemas } from "./schemas.js";

// Consumer-defined roles
const BarberRole = z.enum(["owner", "barber", "client"]);
const schemas = createAuthSchemas(BarberRole, "client");

const ChampionshipRole = z.enum(["admin", "organizer", "player", "spectator"]);
const champSchemas = createAuthSchemas(ChampionshipRole, "spectator");

describe("createAuthSchemas", () => {
  describe("RegisterInput", () => {
    const validInput = {
      email: "user@example.com",
      password: "Secret1!x",
      name: "John",
      tenantId: "tenant-1",
    };

    it("accepts valid input with default role", () => {
      const result = schemas.RegisterInput.parse(validInput);
      expect(result.email).toBe("user@example.com");
      expect(result.role).toBe("client");
    });

    it("uses consumer-defined default role", () => {
      const result = champSchemas.RegisterInput.parse(validInput);
      expect(result.role).toBe("spectator");
    });

    it("normalizes email to lowercase and trims", () => {
      const result = schemas.RegisterInput.parse({
        ...validInput,
        email: "  User@GMAIL.com  ",
      });
      expect(result.email).toBe("user@gmail.com");
    });

    it("rejects invalid email", () => {
      expect(() =>
        schemas.RegisterInput.parse({ ...validInput, email: "not-an-email" })
      ).toThrow();
    });

    it("rejects password shorter than 8 chars", () => {
      expect(() =>
        schemas.RegisterInput.parse({ ...validInput, password: "Ab1!" })
      ).toThrow("at least 8");
    });

    it("rejects password without uppercase", () => {
      expect(() =>
        schemas.RegisterInput.parse({ ...validInput, password: "secret1!x" })
      ).toThrow("uppercase");
    });

    it("rejects password without number", () => {
      expect(() =>
        schemas.RegisterInput.parse({ ...validInput, password: "SecretXx!" })
      ).toThrow("number");
    });

    it("rejects password without special character", () => {
      expect(() =>
        schemas.RegisterInput.parse({ ...validInput, password: "Secret1xx" })
      ).toThrow("special");
    });

    it("accepts consumer-defined roles", () => {
      for (const role of ["owner", "barber", "client"] as const) {
        const result = schemas.RegisterInput.parse({ ...validInput, role });
        expect(result.role).toBe(role);
      }
    });

    it("rejects roles not defined by consumer", () => {
      expect(() =>
        schemas.RegisterInput.parse({ ...validInput, role: "admin" })
      ).toThrow();
    });

    it("accepts championship-specific roles", () => {
      for (const role of ["admin", "organizer", "player", "spectator"] as const) {
        const result = champSchemas.RegisterInput.parse({ ...validInput, role });
        expect(result.role).toBe(role);
      }
    });
  });

  describe("LoginInput", () => {
    it("normalizes email", () => {
      const result = schemas.LoginInput.parse({
        email: "User@Example.COM",
        password: "anything",
        tenantId: "t1",
      });
      expect(result.email).toBe("user@example.com");
    });
  });
});
