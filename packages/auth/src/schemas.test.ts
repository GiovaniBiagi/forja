import { describe, it, expect } from "vitest";
import { RegisterInput, LoginInput, Role } from "./schemas.js";

describe("RegisterInput", () => {
  const validInput = {
    email: "user@example.com",
    password: "Secret1!x",
    name: "John",
    tenantId: "tenant-1",
  };

  it("accepts valid input", () => {
    const result = RegisterInput.parse(validInput);
    expect(result.email).toBe("user@example.com");
    expect(result.role).toBe("client"); // default
  });

  it("normalizes email to lowercase and trims", () => {
    const result = RegisterInput.parse({
      ...validInput,
      email: "  User@GMAIL.com  ",
    });
    expect(result.email).toBe("user@gmail.com");
  });

  it("rejects invalid email", () => {
    expect(() =>
      RegisterInput.parse({ ...validInput, email: "not-an-email" })
    ).toThrow();
  });

  it("rejects password shorter than 8 chars", () => {
    expect(() =>
      RegisterInput.parse({ ...validInput, password: "Ab1!" })
    ).toThrow("at least 8");
  });

  it("rejects password without uppercase", () => {
    expect(() =>
      RegisterInput.parse({ ...validInput, password: "secret1!x" })
    ).toThrow("uppercase");
  });

  it("rejects password without number", () => {
    expect(() =>
      RegisterInput.parse({ ...validInput, password: "SecretXx!" })
    ).toThrow("number");
  });

  it("rejects password without special character", () => {
    expect(() =>
      RegisterInput.parse({ ...validInput, password: "Secret1xx" })
    ).toThrow("special");
  });

  it("accepts all valid roles", () => {
    for (const role of ["owner", "employee", "client"] as const) {
      const result = RegisterInput.parse({ ...validInput, role });
      expect(result.role).toBe(role);
    }
  });
});

describe("LoginInput", () => {
  it("normalizes email", () => {
    const result = LoginInput.parse({
      email: "User@Example.COM",
      password: "anything",
      tenantId: "t1",
    });
    expect(result.email).toBe("user@example.com");
  });
});

describe("Role", () => {
  it("accepts valid roles", () => {
    expect(Role.parse("owner")).toBe("owner");
    expect(Role.parse("employee")).toBe("employee");
    expect(Role.parse("client")).toBe("client");
  });

  it("rejects invalid role", () => {
    expect(() => Role.parse("admin")).toThrow();
  });
});
