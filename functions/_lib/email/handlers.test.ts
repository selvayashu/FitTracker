import { afterEach, describe, expect, it, vi } from "vitest";
import type { DateRange } from "@fittrack/shared";
import { escapeHtml, handleUnsubscribe, handleWeekly } from "./handlers";
import type { EmailDeps } from "./handlers";
import type { EmailProfile, EmailStore, WeekData } from "./store";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./token";
import * as weeklyRoute from "../../api/email/weekly";
import * as unsubRoute from "../../api/email/unsubscribe";

const BASE = "https://app.example.com";
const UID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "223e4567-e89b-42d3-a456-426614174000";
const CRON = "cron-secret-value";
const TOKEN_SECRET = "token-secret-value-0123456789abcdef";
const RESEND_KEY = "re_super_secret_key";
const EMAIL = "someone.private@example.org";
// 2026-03-09T20:30Z is Tuesday 10 March 02:00 IST
const NOW = Date.UTC(2026, 2, 9, 20, 30, 0);

function profile(over: Partial<EmailProfile> = {}): EmailProfile {
  return {
    name: "Asha",
    email_weekly: true,
    last_weekly_email_at: null,
    sex: "female",
    dob: "1990-01-01",
    height_cm: 165,
    weight_kg: 70,
    target_weight_kg: 62,
    goal: "lose",
    pace: 0.5,
    bmi_standard: "who",
    daily_kcal_target: 1800,
    protein_target_g: 100,
    carb_target_g: 200,
    fat_target_g: 60,
    exercise_addback_pct: 50,
    ...over,
  };
}

class FakeStore implements EmailStore {
  profile: EmailProfile | null = profile();
  email: string | null = EMAIL;
  data: WeekData = {
    meals: [{ date: "2026-03-09", meal_type: "lunch", food_name: "Rice", kcal: 600, protein: 20, carbs: 90, fat: 10 }],
    activities: [],
    weights: [],
    typeNames: {},
  };
  ranges: DateRange[] = [];
  claims: string[] = [];
  rollbacks = 0;
  failRollback = false;
  unsub: Array<[string, boolean]> = [];
  get last() {
    return this.profile?.last_weekly_email_at ?? null;
  }
  async getProfile() {
    return this.profile ? { ...this.profile } : null;
  }
  async fetchWeekData(_u: string, r: DateRange) {
    this.ranges.push(r);
    return this.data;
  }
  async getUserEmail() {
    return this.email;
  }
  async claimWeeklySend(_u: string, o: { nowIso: string; cutoffIso: string | null }) {
    const p = this.profile;
    if (!p || !p.email_weekly) return false;
    if (o.cutoffIso && p.last_weekly_email_at && p.last_weekly_email_at >= o.cutoffIso) return false;
    p.last_weekly_email_at = o.nowIso;
    this.claims.push(o.nowIso);
    return true;
  }
  async rollbackWeeklySend(_u: string, o: { claimedIso: string; previousIso: string | null }) {
    if (this.failRollback) throw new Error("x");
    this.rollbacks++;
    if (this.profile && this.profile.last_weekly_email_at === o.claimedIso) this.profile.last_weekly_email_at = o.previousIso;
  }
  async setEmailWeekly(u: string, v: boolean) {
    this.unsub.push([u, v]);
  }
}

interface Setup {
  store: FakeStore;
  deps: EmailDeps;
  calls: Array<{ url: string; init: RequestInit }>;
  logs: string[];
}

function setup(opts: { cron?: string; resend?: Response | "throw"; from?: string } = {}): Setup {
  const store = new FakeStore();
  const calls: Setup["calls"] = [];
  const logs: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (opts.resend === "throw") throw new Error(`network ${EMAIL} ${RESEND_KEY}`);
    return opts.resend ?? new Response('{"id":"1"}', { status: 200 });
  }) as unknown as typeof fetch;
  const deps: EmailDeps = {
    store,
    fetch: fakeFetch,
    config: {
      cronSecret: opts.cron ?? CRON,
      tokenSecret: TOKEN_SECRET,
      resendKey: RESEND_KEY,
      emailFrom: opts.from,
    },
    nowMs: () => NOW,
    log: (m) => logs.push(m),
  };
  return { store, deps, calls, logs };
}

const weeklyReq = (body: unknown, headers: Record<string, string> = { "x-cron-secret": CRON }, method = "POST") =>
  new Request(`${BASE}/api/email/weekly`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => vi.restoreAllMocks());

describe("weekly: auth and validation", () => {
  it("rejects missing, wrong and empty-configured secrets", async () => {
    const s = setup();
    expect((await handleWeekly(weeklyReq({ user_id: UID }, {}), s.deps)).status).toBe(401);
    expect((await handleWeekly(weeklyReq({ user_id: UID }, { "x-cron-secret": "nope" }), s.deps)).status).toBe(401);
    const empty = setup({ cron: "" });
    expect((await handleWeekly(weeklyReq({ user_id: UID }, { "x-cron-secret": "" }), empty.deps)).status).toBe(401);
    const res = await handleWeekly(weeklyReq({ user_id: UID }, { "x-cron-secret": "anything" }), empty.deps);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "unauthorized" });
    expect(s.calls).toHaveLength(0);
  });

  it("accepts the right secret", async () => {
    const s = setup();
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(200);
  });

  it("validates the body", async () => {
    const s = setup();
    for (const b of [{}, { user_id: "abc" }, { user_id: 5 }, { user_id: UID, force: "yes" }, "not json", "[]"]) {
      const res = await handleWeekly(weeklyReq(b), s.deps);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "invalid_request" });
    }
  });

  it("returns 405 for other methods", async () => {
    const s = setup();
    const res = await handleWeekly(weeklyReq(null, {}, "GET"), s.deps);
    expect(res.status).toBe(405);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("weekly: guards", () => {
  it("not_opted_in", async () => {
    const s = setup();
    s.store.profile = profile({ email_weekly: false });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(await res.json()).toEqual({ sent: false, reason: "not_opted_in" });
    expect(s.calls).toHaveLength(0);
  });

  it("recently_sent, and force bypasses it", async () => {
    const s = setup();
    s.store.profile = profile({ last_weekly_email_at: new Date(NOW - 5 * 86_400_000).toISOString() });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(await res.json()).toEqual({ sent: false, reason: "recently_sent" });
    expect(s.calls).toHaveLength(0);
    const forced = await handleWeekly(weeklyReq({ user_id: UID, force: true }), s.deps);
    expect(await forced.json()).toEqual({ sent: true });
    expect(s.calls).toHaveLength(1);
  });

  it("sends when the last mail is older than 6 days", async () => {
    const s = setup();
    s.store.profile = profile({ last_weekly_email_at: new Date(NOW - 7 * 86_400_000).toISOString() });
    expect(await (await handleWeekly(weeklyReq({ user_id: UID }), s.deps)).json()).toEqual({ sent: true });
  });

  it("no_data when no meals were logged; nothing sent", async () => {
    const s = setup();
    s.store.data = { ...s.store.data, meals: [] };
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(await res.json()).toEqual({ sent: false, reason: "no_data" });
    expect(s.calls).toHaveLength(0);
    expect(s.store.last).toBeNull();
  });

  it("no_data for a missing or incomplete profile", async () => {
    const s = setup();
    s.store.profile = profile({ dob: null });
    expect(await (await handleWeekly(weeklyReq({ user_id: UID }), s.deps)).json()).toEqual({ sent: false, reason: "no_data" });
    s.store.profile = null;
    expect(await (await handleWeekly(weeklyReq({ user_id: UID }), s.deps)).json()).toEqual({ sent: false, reason: "no_data" });
    expect(s.calls).toHaveLength(0);
  });

  it("no_email when auth has no address", async () => {
    const s = setup();
    s.store.email = null;
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(await res.json()).toEqual({ sent: false, reason: "no_email" });
    expect(s.calls).toHaveLength(0);
  });

  it("uses the 7 IST days ending yesterday across the IST day boundary", async () => {
    const s = setup();
    await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(s.store.ranges).toEqual([{ from: "2026-03-03", to: "2026-03-09" }]);
  });
});

describe("weekly: sending", () => {
  it("sends the expected Resend request and records the send", async () => {
    const s = setup({ from: "FitTrack <summary@example.com>" });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(s.calls).toHaveLength(1);
    const { url, init } = s.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${RESEND_KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("FitTrack <summary@example.com>");
    expect(body.to).toEqual([EMAIL]);
    expect(body.subject).toBe("Your FitTrack week: 3 Mar - 9 Mar 2026");
    expect(body.text.length).toBeGreaterThan(0);
    const token = await signUnsubscribeToken(TOKEN_SECRET, UID);
    const unsubUrl = `${BASE}/api/email/unsubscribe?token=${token}`;
    expect(body.headers["List-Unsubscribe"]).toBe(`<${unsubUrl}>`);
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.html).toContain(unsubUrl);
    expect(body.text).toContain(unsubUrl);
    expect(s.store.last).toBe(new Date(NOW).toISOString());
    // The key appears only in the Authorization header.
    expect(init.body as string).not.toContain(RESEND_KEY);
  });

  it("defaults the sender", async () => {
    const s = setup();
    await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(JSON.parse(s.calls[0].init.body as string).from).toBe("FitTrack <onboarding@resend.dev>");
  });

  it("returns 502 and leaves last_weekly_email_at alone when Resend rejects", async () => {
    const s = setup({ resend: new Response("bad", { status: 422 }) });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ sent: false, reason: "send_failed" });
    expect(s.store.last).toBeNull();
  });

  it("returns 502 on a network failure", async () => {
    const s = setup({ resend: "throw" });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(502);
    expect(s.store.last).toBeNull();
  });

  it("restores the previous timestamp when the send fails", async () => {
    const prev = new Date(NOW - 8 * 86_400_000).toISOString();
    const s = setup({ resend: new Response("x", { status: 500 }) });
    s.store.profile = profile({ last_weekly_email_at: prev });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(502);
    expect(s.store.claims).toHaveLength(1);
    expect(s.store.last).toBe(prev);
  });

  it("rollback does not clobber a newer value", async () => {
    const s = setup({ resend: "throw" });
    const newer = new Date(NOW + 1000).toISOString();
    const orig = s.deps.fetch;
    s.deps.fetch = (async (...a: Parameters<typeof fetch>) => {
      s.store.profile!.last_weekly_email_at = newer;
      return orig(...a);
    }) as typeof fetch;
    await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(s.store.last).toBe(newer);
  });

  it("a failing rollback still returns 502", async () => {
    const s = setup({ resend: new Response("x", { status: 500 }) });
    s.store.failRollback = true;
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(502);
    expect(s.logs.some((l) => l.includes("warning"))).toBe(true);
  });

  it("two concurrent calls send once", async () => {
    const s = setup();
    const [a, b] = await Promise.all([
      handleWeekly(weeklyReq({ user_id: UID }), s.deps),
      handleWeekly(weeklyReq({ user_id: UID }), s.deps),
    ]);
    const bodies = [await a.json(), await b.json()] as Array<{ sent: boolean; reason?: string }>;
    expect(bodies.filter((x) => x.sent)).toHaveLength(1);
    expect(bodies.find((x) => !x.sent)).toEqual({ sent: false, reason: "recently_sent" });
    expect(s.calls).toHaveLength(1);
  });

  it("sends a workouts-only week and says no meals were logged", async () => {
    const s = setup();
    s.store.data = {
      meals: [],
      weights: [],
      typeNames: { 1: "Run" },
      activities: [{
        id: "a1", start_time: "2026-03-05T06:00:00Z", activity_type_id: 1, custom_name: null, name: null, source: "manual",
        duration_min: 30, distance_km: 5, avg_hr: null, max_hr: null, calories: 300, calories_estimated: false,
        excluded: false, zones: null,
      }],
    };
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(await res.json()).toEqual({ sent: true });
    const body = JSON.parse(s.calls[0].init.body as string);
    expect(body.text.toLowerCase()).toContain("did not log meals");
    expect(body.text + body.html).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("explains a refused sandbox sender when EMAIL_FROM is unset", async () => {
    const s = setup({ resend: new Response("forbidden", { status: 403 }) });
    const res = await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ sent: false, reason: "send_failed", hint: "sandbox_sender" });
    expect(s.logs.filter((l) => l.includes("sandbox sender"))).toEqual([
      "email: Resend refused the sandbox sender (set EMAIL_FROM to an address on a verified domain)",
    ]);
    const custom = setup({ resend: new Response("forbidden", { status: 403 }), from: "A <a@example.com>" });
    const r2 = await handleWeekly(weeklyReq({ user_id: UID }), custom.deps);
    expect(await r2.json()).toEqual({ sent: false, reason: "send_failed" });
  });

  it("never logs secrets, tokens or the address", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const token = await signUnsubscribeToken(TOKEN_SECRET, UID);
    for (const resend of ["throw", new Response("x", { status: 500 }), undefined] as const) {
      const s = setup({ resend });
      s.store.failRollback = true;
      await handleWeekly(weeklyReq({ user_id: UID }), s.deps);
      await handleWeekly(weeklyReq({ user_id: UID }, { "x-cron-secret": "wrong-guess" }), s.deps);
      await handleUnsubscribe(new Request(`${BASE}/api/email/unsubscribe?token=${token}`, { method: "POST" }), s.deps);
      const all = s.logs.join("\n");
      for (const secret of [CRON, TOKEN_SECRET, RESEND_KEY, EMAIL, token, "wrong-guess"]) expect(all).not.toContain(secret);
    }
    const consoleText = spies.flatMap((sp) => sp.mock.calls).map((c) => c.join(" ")).join("\n");
    for (const secret of [CRON, TOKEN_SECRET, RESEND_KEY, EMAIL, token]) expect(consoleText).not.toContain(secret);
  });
});

describe("token", () => {
  it("round-trips", async () => {
    const t = await signUnsubscribeToken(TOKEN_SECRET, UID);
    expect(t.startsWith(`${UID}.`)).toBe(true);
    expect(t).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    expect(await verifyUnsubscribeToken(TOKEN_SECRET, t)).toBe(UID);
  });
  it("rejects tampering, wrong secret, wrong user, malformed input", async () => {
    const t = await signUnsubscribeToken(TOKEN_SECRET, UID);
    const [, sig] = t.split(".");
    expect(await verifyUnsubscribeToken(TOKEN_SECRET, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(await verifyUnsubscribeToken("other-secret", t)).toBeNull();
    expect(await verifyUnsubscribeToken(TOKEN_SECRET, `${OTHER}.${sig}`)).toBeNull();
    expect(await verifyUnsubscribeToken("", t)).toBeNull();
    for (const bad of ["", "abc", `${UID}`, `${UID}.`, `${UID}.a.b`, `not-a-uuid.${sig}`, `.${sig}`]) {
      expect(await verifyUnsubscribeToken(TOKEN_SECRET, bad)).toBeNull();
    }
  });
});

describe("unsubscribe", () => {
  const url = (q = "") => `${BASE}/api/email/unsubscribe${q}`;

  it("GET shows a page and does not mutate", async () => {
    const s = setup();
    const t = await signUnsubscribeToken(TOKEN_SECRET, UID);
    const res = await handleUnsubscribe(new Request(url(`?token=${t}`)), s.deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    const html = await res.text();
    expect(html).toContain('method="post"');
    expect(html).toContain(`value="${t}"`);
    expect(html).not.toMatch(/https?:\/\/(?!app\.example\.com)/);
    expect(s.store.unsub).toHaveLength(0);
  });

  it("POST with a form body unsubscribes", async () => {
    const s = setup();
    const t = await signUnsubscribeToken(TOKEN_SECRET, UID);
    const res = await handleUnsubscribe(
      new Request(url(), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: t }).toString(),
      }),
      s.deps,
    );
    expect(res.status).toBe(200);
    expect(s.store.unsub).toEqual([[UID, false]]);
  });

  it("one-click POST (token in query) unsubscribes", async () => {
    const s = setup();
    const t = await signUnsubscribeToken(TOKEN_SECRET, UID);
    const res = await handleUnsubscribe(
      new Request(url(`?token=${t}`), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }),
      s.deps,
    );
    expect(res.status).toBe(200);
    expect(s.store.unsub).toEqual([[UID, false]]);
  });

  it("invalid or missing token gives 400 and no state change", async () => {
    const s = setup();
    const good = await signUnsubscribeToken(TOKEN_SECRET, UID);
    const forged = `${OTHER}.${good.split(".")[1]}`;
    for (const method of ["GET", "POST"]) {
      for (const q of ["", "?token=junk", `?token=${forged}`, `?token=${good}x`]) {
        const res = await handleUnsubscribe(new Request(url(q), { method }), s.deps);
        expect(res.status).toBe(400);
        expect(res.headers.get("content-type")).toContain("text/html");
      }
    }
    expect(s.store.unsub).toHaveLength(0);
  });

  it("escapes everything it prints", async () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
    const s = setup();
    const res = await handleUnsubscribe(new Request(url(`?token=%22%3E%3Cscript%3Ealert(1)%3C/script%3E`)), s.deps);
    const html = await res.text();
    expect(html).not.toContain("<script");
  });

  it("405 for other methods", async () => {
    const s = setup();
    const res = await handleUnsubscribe(new Request(url(), { method: "DELETE" }), s.deps);
    expect(res.status).toBe(405);
  });
});

describe("route files", () => {
  it("export handlers and a 405 catch-all, and no library exports onRequest", async () => {
    expect(typeof weeklyRoute.onRequestPost).toBe("function");
    expect(typeof unsubRoute.onRequestGet).toBe("function");
    expect(typeof unsubRoute.onRequestPost).toBe("function");
    const ctx = {} as Parameters<typeof weeklyRoute.onRequest>[0];
    expect((await weeklyRoute.onRequest(ctx)).status).toBe(405);
    expect((await unsubRoute.onRequest(ctx)).status).toBe(405);
    const lib = await import("./handlers");
    expect(Object.keys(lib).filter((k) => k.startsWith("onRequest"))).toEqual([]);
  });
});
