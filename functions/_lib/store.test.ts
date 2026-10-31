import { describe, expect, it } from "vitest";
import { createSupabaseStore } from "./store";
import { createStravaClient } from "./strava";
import { detail } from "./testing";
import { buildActivityFromStrava } from "@fittrack/shared";

const row = buildActivityFromStrava(detail(5), {
  userId: "u1",
  typeIdByName: { Running: 1, Other: 99 },
  metByTypeId: {},
  weightKg: 70,
  maxHr: 190,
  id: "fresh-uuid",
});

function fakeFetch(handler: (method: string, url: string, body: string) => unknown) {
  const calls: Array<{ method: string; url: string; body: string; prefer: string }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = await req.text();
    calls.push({ method: req.method, url: req.url, body, prefer: req.headers.get("Prefer") ?? "" });
    return new Response(JSON.stringify(handler(req.method, req.url, body)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { f, calls };
}

describe("supabase store: upsertStravaActivity", () => {
  it("new row: one insert-ignore-duplicates, no update", async () => {
    const { f, calls } = fakeFetch(() => [{ id: "fresh-uuid" }]);
    const store = createSupabaseStore({ url: "http://db.test", serviceRoleKey: "k", fetch: f });
    expect(await store.upsertStravaActivity(row)).toBe("fresh-uuid");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls[0].prefer).toContain("ignore-duplicates");
  });

  it("existing row (conflict): updates Strava-owned columns by strava_id and NEVER sends an id", async () => {
    const { f, calls } = fakeFetch((method) => (method === "POST" ? [] : [{ id: "existing-id" }]));
    const store = createSupabaseStore({ url: "http://db.test", serviceRoleKey: "k", fetch: f });
    expect(await store.upsertStravaActivity(row)).toBe("existing-id");
    expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
    const patch = JSON.parse(calls[1].body) as Record<string, unknown>;
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("user_id");
    for (const k of ["notes", "excluded", "duplicate_dismissed", "duplicate_of"]) expect(patch).not.toHaveProperty(k);
    expect(patch.name).toBe("Run 5");
    expect(calls[1].url).toContain("strava_id=eq.5");
    expect(calls[1].url).toContain("user_id=eq.u1");
  });
});

describe("strava client: invalid grant detection", () => {
  const mk = (body: unknown, status = 400) =>
    createStravaClient({
      clientId: "c",
      clientSecret: "s",
      fetch: (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch,
    });

  it("flags invalid_grant and refresh_token field errors only", async () => {
    const a = await mk({ error: "invalid_grant" }).refreshToken("r").catch((e: unknown) => e);
    expect((a as { grantInvalid: boolean }).grantInvalid).toBe(true);
    const b = await mk({ message: "Bad Request", errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }] })
      .refreshToken("r")
      .catch((e: unknown) => e);
    expect((b as { grantInvalid: boolean }).grantInvalid).toBe(true);
    const c = await mk({ message: "Bad Request", errors: [{ resource: "Application", field: "client_id", code: "invalid" }] })
      .refreshToken("r")
      .catch((e: unknown) => e);
    expect((c as { grantInvalid: boolean }).grantInvalid).toBe(false);
  });
});
