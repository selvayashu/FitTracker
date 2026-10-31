import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, guarded, requireConfig } from "./http";

const ctx = {} as Parameters<ReturnType<typeof guarded>>[0];

describe("requireConfig", () => {
  it("lists every missing or empty setting by name", () => {
    const env = { SUPABASE_URL: "https://x.supabase.co", STRAVA_CLIENT_ID: "  ", STRAVA_CLIENT_SECRET: "s3cr3t" } as Env;
    try {
      requireConfig(env, ["SUPABASE_URL", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "CRON_SECRET"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).missing).toEqual(["STRAVA_CLIENT_ID", "CRON_SECRET"]);
    }
  });
  it("passes when everything is set", () => {
    expect(() => requireConfig({ SUPABASE_URL: "u" } as Env, ["SUPABASE_URL"])).not.toThrow();
  });
});

describe("guarded", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes a normal response through", async () => {
    const res = await guarded(() => new Response("ok", { status: 201 }))(ctx);
    expect(res.status).toBe(201);
  });

  it("turns a missing setting into a clear 500 naming the setting, with no values", async () => {
    const res = await guarded(() => { throw new ConfigError(["SUPABASE_URL", "CRON_SECRET"]); })(ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("not_configured");
    expect(body.message).toContain("SUPABASE_URL");
    expect(body.message).toContain("CRON_SECRET");
  });

  it("hides the message of an unexpected error and logs only its class", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await guarded(async () => { throw new TypeError("token=abc123 leaked"); })(ctx);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("internal_error");
    expect(text).not.toContain("abc123");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("abc123");
    expect(logged).toContain("TypeError");
  });
});
