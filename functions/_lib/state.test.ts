import { describe, expect, it } from "vitest";
import { STATE_TTL_SEC, signState, timingSafeEqualStr, verifyState } from "./state";

const SECRET = "unit-test-secret-0123456789";

describe("oauth state", () => {
  it("round-trips the user id", async () => {
    const s = await signState(SECRET, "user-1", 1000);
    expect(await verifyState(SECRET, s, 1001)).toBe("user-1");
  });

  it("rejects a tampered payload", async () => {
    const s = await signState(SECRET, "user-1", 1000);
    const [, sig] = s.split(".");
    const forged = btoa(JSON.stringify({ uid: "attacker", exp: 99999 })).replace(/=+$/, "");
    expect(await verifyState(SECRET, `${forged}.${sig}`, 1001)).toBeNull();
  });

  it("rejects a tampered signature, malformed tokens and empty input", async () => {
    const s = await signState(SECRET, "user-1", 1000);
    expect(await verifyState(SECRET, s.slice(0, -2) + "xx", 1001)).toBeNull();
    expect(await verifyState(SECRET, "nodot", 1001)).toBeNull();
    expect(await verifyState(SECRET, "a.b.c", 1001)).toBeNull();
    expect(await verifyState(SECRET, "", 1001)).toBeNull();
  });

  it("expires after 10 minutes", async () => {
    const s = await signState(SECRET, "user-1", 1000);
    expect(STATE_TTL_SEC).toBe(600);
    expect(await verifyState(SECRET, s, 1000 + 599)).toBe("user-1");
    expect(await verifyState(SECRET, s, 1000 + 600)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const s = await signState("other-secret", "user-1", 1000);
    expect(await verifyState(SECRET, s, 1001)).toBeNull();
  });

  it("timingSafeEqualStr", () => {
    expect(timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
  });
});
