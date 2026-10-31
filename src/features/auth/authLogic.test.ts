import { describe, expect, it } from "vitest";
import { mapAuthError, validateEmail, validatePassword } from "./authLogic";

describe("auth validation", () => {
  it("validates email", () => {
    expect(validateEmail("")).not.toBeNull();
    expect(validateEmail("a@b")).not.toBeNull();
    expect(validateEmail(" a@b.co ")).toBeNull();
  });
  it("requires 8 character passwords", () => {
    expect(validatePassword("1234567")).not.toBeNull();
    expect(validatePassword("12345678")).toBeNull();
  });
  it("maps common errors", () => {
    expect(mapAuthError("Invalid login credentials")).toMatch(/incorrect/);
    expect(mapAuthError("User already registered")).toMatch(/already exists/);
    expect(mapAuthError("Email not confirmed")).toMatch(/confirm/);
    expect(mapAuthError("weird")).toBe("weird");
  });
});
