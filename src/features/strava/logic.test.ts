import { describe, expect, it } from "vitest";
import type { SyncResult } from "@fittrack/shared";
import {
  BUSY_WAIT_SEC, MAX_BATCHES, MAX_BUSY_RETRIES, isBusyResult,
  AUTO_SYNC_INTERVAL_MS, MAX_RATE_LIMIT_RETRIES, chipView, clampWaitSec, formatCountdown, friendlyStatusError, mapReturnReason, mapStravaError,
  parseReturnParams, progressText, secondsLeft, shouldAutoSync, stripReturnParams, syncLoop,
} from "./logic";

describe("shouldAutoSync", () => {
  const now = 1_000_000_000;
  it("never when not connected", () => expect(shouldAutoSync({ connected: false, lastAttemptMs: null, nowMs: now })).toBe(false));
  it("yes when never attempted", () => expect(shouldAutoSync({ connected: true, lastAttemptMs: null, nowMs: now })).toBe(true));
  it("no within 15 minutes, boundary inclusive", () => {
    expect(shouldAutoSync({ connected: true, lastAttemptMs: now - 60_000, nowMs: now })).toBe(false);
    expect(shouldAutoSync({ connected: true, lastAttemptMs: now - AUTO_SYNC_INTERVAL_MS, nowMs: now })).toBe(false);
    expect(shouldAutoSync({ connected: true, lastAttemptMs: now - AUTO_SYNC_INTERVAL_MS - 1, nowMs: now })).toBe(true);
  });
  it("yes when the stored time is in the future", () => expect(shouldAutoSync({ connected: true, lastAttemptMs: now + 5000, nowMs: now })).toBe(true));
});

describe("countdown and progress", () => {
  it("formats m:ss", () => {
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(formatCountdown(900)).toBe("15:00");
  });
  it("secondsLeft rounds up and floors at 0", () => {
    expect(secondsLeft(10_500, 10_000)).toBe(1);
    expect(secondsLeft(9_000, 10_000)).toBe(0);
  });
  it("clamps the wait", () => {
    expect(clampWaitSec(0)).toBe(5);
    expect(clampWaitSec(30.2)).toBe(31);
    expect(clampWaitSec(99999)).toBe(900);
    expect(clampWaitSec(NaN)).toBe(5);
  });
  it("progress text", () => {
    expect(progressText({ processed: 1, remaining: null })).toBe("Synced 1 activity so far");
    expect(progressText({ processed: 15, remaining: 7 })).toBe("Synced 15 activities, about 7 left");
  });
});

describe("error mapping", () => {
  it.each([["not_connected", "reconnect"], ["strava_revoked", "reconnect"], ["network", "retry"], ["unauthenticated", "signin"], ["boom", "retry"]])(
    "%s -> %s", (code, action) => expect(mapStravaError(code).action).toBe(action),
  );
  it("maps not_configured to a friendly message", () => {
    const m = mapStravaError("not_configured", "STRAVA_CLIENT_ID missing");
    expect(m.message).toMatch(/not set up on this server/);
    expect(m.message).not.toContain("STRAVA_CLIENT_ID");
  });
  it("never shows raw server text for unknown codes", () => {
    expect(mapStravaError("x", "oops").message).toBe("Something went wrong talking to Strava. Please try again.");
  });
  it("friendlyStatusError maps without leaking raw text", () => {
    expect(friendlyStatusError("TypeError: Failed to fetch")).toMatch(/Could not reach/);
    expect(friendlyStatusError("JWT expired")).toMatch(/session expired/);
    expect(friendlyStatusError("not_configured")).toMatch(/not set up/);
    expect(friendlyStatusError("relation x violates 42P01")).toBe("Something went wrong talking to Strava. Please try again.");
    expect(friendlyStatusError(null)).toBe("Something went wrong talking to Strava. Please try again.");
  });
  it("maps return reasons", () => {
    expect(mapReturnReason("access_denied")).toMatch(/cancelled/);
    expect(mapReturnReason(null)).toMatch(/Could not connect/);
  });
});

describe("return params", () => {
  it("parses", () => {
    expect(parseReturnParams("?strava=connected")).toEqual({ kind: "connected" });
    expect(parseReturnParams("?strava=error&reason=access_denied")).toEqual({ kind: "error", reason: "access_denied" });
    expect(parseReturnParams("?strava=error")).toEqual({ kind: "error", reason: null });
    expect(parseReturnParams("?x=1")).toBeNull();
  });
  it("strips only strava params", () => {
    expect(stripReturnParams("?strava=error&reason=a")).toBe("");
    expect(stripReturnParams("?a=1&strava=connected")).toBe("?a=1");
  });
});

describe("chipView", () => {
  const base = { connected: true, phase: "idle" as const, lastSyncAt: null, countdownSec: 0, error: null };
  it("hidden when not connected", () => expect(chipView({ ...base, connected: false })).toBeNull());
  it("states", () => {
    expect(chipView(base)?.label).toBe("Not synced yet");
    expect(chipView({ ...base, lastSyncAt: "2026-03-10T01:00:00Z" })?.label).toMatch(/^Last sync .* IST$/);
    expect(chipView({ ...base, phase: "syncing" })?.tone).toBe("busy");
    expect(chipView({ ...base, phase: "waiting", countdownSec: 65 })?.label).toBe("Rate limited, retrying in 1:05");
    const err = chipView({ ...base, phase: "error", error: mapStravaError("network") });
    expect(err?.tone).toBe("error");
    expect(err?.showRetry).toBe(true);
    expect(chipView({ ...base, phase: "error", error: mapStravaError("strava_revoked") })?.showRetry).toBe(false);
  });
});

function harness(results: Array<SyncResult | Error>, cancelAfterCalls = Infinity) {
  const waits: number[] = [];
  const modes: Array<string | undefined> = [];
  const progress: Array<{ processed: number; remaining: number | null }> = [];
  let calls = 0;
  const deps = {
    run: async (m?: "initial" | "incremental") => {
      modes.push(m);
      const r = results[Math.min(calls++, results.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    wait: async (s: number) => { waits.push(s); },
    isCancelled: () => calls >= cancelAfterCalls,
    onProgress: (p: { processed: number; remaining: number | null }) => { progress.push(p); },
    onRateLimited: () => {},
    onResume: () => {},
    mode: "incremental" as const,
  };
  return { deps, waits, modes, progress, calls: () => calls };
}

describe("syncLoop", () => {
  it("loops until done and accumulates", async () => {
    const h = harness([{ done: false, processed: 15, remaining: 10 }, { done: true, processed: 10, remaining: 0 }]);
    expect(await syncLoop(h.deps)).toEqual({ outcome: "done", processed: 25 });
    expect(h.modes).toEqual(["incremental", "incremental"]);
    expect(h.progress.at(-1)).toEqual({ processed: 25, remaining: 0 });
  });
  it("waits out a rate limit and resumes", async () => {
    const h = harness([{ done: false, processed: 3, remaining: 5, rateLimited: { retryAfterSec: 120 } }, { done: true, processed: 5, remaining: 0 }]);
    expect((await syncLoop(h.deps)).outcome).toBe("done");
    expect(h.waits).toEqual([120]);
  });
  it("gives up after too many rate limit retries", async () => {
    const h = harness([{ done: false, processed: 0, remaining: null, rateLimited: { retryAfterSec: 10 } }]);
    expect((await syncLoop(h.deps)).outcome).toBe("rate_limited");
    expect(h.waits).toHaveLength(MAX_RATE_LIMIT_RETRIES);
  });
  it("stops when cancelled", async () => {
    const h = harness([{ done: false, processed: 1, remaining: 9 }], 1);
    expect((await syncLoop(h.deps)).outcome).toBe("cancelled");
    expect(h.calls()).toBe(1);
  });
  it("propagates errors", async () => {
    const h = harness([new Error("x")]);
    await expect(syncLoop(h.deps)).rejects.toThrow("x");
  });
});

describe("busy lease", () => {
  it("detects both busy shapes but not rate limits or real progress", () => {
    expect(isBusyResult({ done: false, processed: 0, remaining: null })).toBe(true);
    expect(isBusyResult({ done: false, processed: 0, remaining: 4, busy: true } as SyncResult)).toBe(true);
    expect(isBusyResult({ done: false, processed: 0, remaining: null, rateLimited: { retryAfterSec: 9 } })).toBe(false);
    expect(isBusyResult({ done: false, processed: 3, remaining: null })).toBe(false);
    expect(isBusyResult({ done: true, processed: 0, remaining: 0 })).toBe(false);
  });
  it("waits 8s between busy answers, then continues", async () => {
    const h = harness([{ done: false, processed: 0, remaining: null }, { done: true, processed: 2, remaining: 0 }]);
    expect(await syncLoop(h.deps)).toEqual({ outcome: "done", processed: 2 });
    expect(h.waits).toEqual([BUSY_WAIT_SEC]);
  });
  it("returns busy after the cap without spinning", async () => {
    const h = harness([{ done: false, processed: 0, remaining: null }]);
    expect((await syncLoop({ ...h.deps, busyWaitSec: 1 })).outcome).toBe("busy");
    expect(h.waits).toHaveLength(MAX_BUSY_RETRIES);
    expect(h.calls()).toBe(MAX_BUSY_RETRIES + 1);
  });
});

describe("batch cap", () => {
  it("returns too_many_batches, not a rate-limit outcome", async () => {
    const h = harness([{ done: false, processed: 1, remaining: 9999 }]);
    const r = await syncLoop(h.deps);
    expect(r.outcome).toBe("too_many_batches");
    expect(h.calls()).toBe(MAX_BATCHES);
    expect(h.waits).toEqual([]);
  });
  it("notifies onResponse for each answer", async () => {
    const h = harness([{ done: true, processed: 1, remaining: 0 }]);
    let n = 0;
    await syncLoop({ ...h.deps, onResponse: () => { n++; } });
    expect(n).toBe(1);
  });
});

describe("all Worker redirect reasons are mapped", () => {
  const generic = mapReturnReason("zzz");
  it.each(["access_denied", "oauth_error", "invalid_state", "missing_scope", "missing_code", "exchange_failed", "store_failed"])("%s", (r) => {
    expect(mapReturnReason(r)).not.toBe(generic);
  });
  it("missing_scope mentions the box", () => expect(mapReturnReason("missing_scope")).toMatch(/View data about your activities/));
  it("info chips show the message", () => {
    const e = { code: "busy", action: "retry" as const, message: "A sync is already running, try again in a minute." };
    expect(chipView({ connected: true, phase: "error", lastSyncAt: null, countdownSec: 0, error: e })?.label).toBe(e.message);
  });
});
