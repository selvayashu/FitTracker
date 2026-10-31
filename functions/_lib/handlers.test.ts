import { describe, expect, it } from "vitest";
import {
  handleCallback,
  handleConnect,
  handleDisconnect,
  handleSync,
  handleWebhookGet,
  handleWebhookPost,
  processWebhookEvent,
} from "./handlers";
import { signState } from "./state";
import { StravaHttpError } from "./strava";
import { NOW_SEC, authed, makeConn, makeDeps } from "./testing";
import * as connectRoute from "../api/strava/connect";
import * as callbackRoute from "../api/strava/callback";
import * as syncRoute from "../api/strava/sync";
import * as disconnectRoute from "../api/strava/disconnect";
import * as webhookRoute from "../api/strava/webhook";

const BASE = "https://app.example.com";

describe("connect", () => {
  it("returns the authorize URL with the contract parameters and a signed state", async () => {
    const deps = makeDeps();
    const res = await handleConnect(authed(`${BASE}/api/strava/connect`, {}), deps);
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe(`${BASE}/api/strava/callback`);
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("approval_prompt")).toBe("auto");
    expect(u.searchParams.get("scope")).toBe("read,activity:read_all");
    expect(u.searchParams.get("state")).toBeTruthy();
  });
});

describe("callback", () => {
  const cb = async (query: string, deps = makeDeps()) => {
    const res = await handleCallback(new Request(`${BASE}/api/strava/callback?${query}`), deps);
    return { res, deps, loc: res.headers.get("Location") ?? "" };
  };
  const goodState = () => signState(makeDeps().config.stateSecret, "u1", NOW_SEC);

  it("stores the connection with a 90 day initial cursor and redirects to connected", async () => {
    const deps = makeDeps();
    const { res, loc } = await cb(
      `code=abc&scope=read,activity:read_all&state=${await goodState()}`,
      deps,
    );
    expect(res.status).toBe(302);
    expect(loc).toBe(`${BASE}/settings?strava=connected`);
    const c = deps.store.conns.get("u1")!;
    expect(c.athlete_id).toBe(42);
    expect(c.sync_cursor).toEqual({ mode: "initial", after: NOW_SEC - 90 * 86400, page: 1, pending: [] });
  });

  it("handles access_denied", async () => {
    const { res, loc } = await cb("error=access_denied");
    expect(res.status).toBe(302);
    expect(loc).toBe(`${BASE}/settings?strava=error&reason=access_denied`);
  });

  it("rejects bad or missing state without exchanging the code", async () => {
    const deps = makeDeps();
    const a = await cb("code=abc&scope=read,activity:read_all&state=bogus", deps);
    expect(a.loc).toContain("reason=invalid_state");
    expect(deps.strava.calls).toEqual([]);
  });

  it("requires the activity:read_all scope", async () => {
    const deps = makeDeps();
    const { loc } = await cb(`code=abc&scope=read&state=${await goodState()}`, deps);
    expect(loc).toBe(`${BASE}/settings?strava=error&reason=missing_scope`);
    expect(deps.strava.calls).toEqual([]);
    expect(deps.store.conns.size).toBe(0);
  });

  it("redirects with exchange_failed and leaks no tokens in the URL", async () => {
    const deps = makeDeps();
    deps.strava.fail("exchange", new StravaHttpError(400));
    const { loc } = await cb(`code=abc&scope=read,activity:read_all&state=${await goodState()}`, deps);
    expect(loc).toBe(`${BASE}/settings?strava=error&reason=exchange_failed`);
  });
});

describe("sync handler", () => {
  const syncReq = (body: unknown = {}) => authed(`${BASE}/api/strava/sync`, body);

  it("returns not_connected (404) when there is no connection", async () => {
    const res = await handleSync(syncReq(), makeDeps());
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("not_connected");
  });

  it("runs a batch, releases the lease and returns a SyncResult", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.pages = [[1, 2]];
    const res = await handleSync(syncReq(), deps);
    expect(await res.json()).toEqual({ done: true, processed: 2, remaining: 0 });
    expect(deps.store.conns.get("u1")!.sync_cursor).toEqual({ mode: "incremental" });
  });

  it("refreshes an expiring token before syncing and persists both tokens", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ expires_at: NOW_SEC + 10, sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    await handleSync(syncReq(), deps);
    expect(deps.store.tokenUpdates).toHaveLength(1);
    expect(deps.strava.calls[0]).toBe("refresh:ref-old");
  });

  it("a held lease prevents double processing", async () => {
    const deps = makeDeps();
    const conn = deps.store.add(
      makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [], lease_until: NOW_SEC * 1000 + 30_000 } }),
    );
    deps.strava.pages = [[1]];
    const res = await handleSync(syncReq(), deps);
    expect(await res.json()).toEqual({ done: false, processed: 0, remaining: null, busy: true });
    expect(deps.strava.calls).toEqual([]);
    expect(conn.sync_cursor?.lease_until).toBe(NOW_SEC * 1000 + 30_000);
  });

  it("two simultaneous calls: only one processes", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.pages = [[1, 2, 3]];
    const [a, b] = await Promise.all([handleSync(syncReq(), deps), handleSync(syncReq(), deps)]);
    const ra = (await a.json()) as { processed: number };
    const rb = (await b.json()) as { processed: number };
    expect([ra.processed, rb.processed].sort()).toEqual([0, 3]);
  });

  it("an expired lease can be taken over", async () => {
    const deps = makeDeps();
    deps.store.add(
      makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [], lease_until: 1000 } }),
    );
    deps.strava.pages = [[1]];
    const res = await handleSync(syncReq(), deps);
    expect(((await res.json()) as { processed: number }).processed).toBe(1);
  });

  it("revoked access deletes the connection and returns strava_revoked", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.pages = [[1]];
    deps.strava.fail("detail:1", new StravaHttpError(401));
    const res = await handleSync(syncReq(), deps);
    expect(((await res.json()) as { error: string }).error).toBe("strava_revoked");
    expect(deps.store.conns.has("u1")).toBe(false);
  });

  it("rate limiting is returned in the body, not as an error", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.pages = [[1]];
    deps.strava.fail("detail:1", new StravaHttpError(429, 300));
    const res = await handleSync(syncReq(), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: false, processed: 0, remaining: 1, rateLimited: { retryAfterSec: 300 } });
  });

  it("a 429 during token refresh is a rate-limited result, not a 502, and releases the lease", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ expires_at: NOW_SEC - 1, sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.fail("refresh", new StravaHttpError(429, 321));
    const res = await handleSync(syncReq(), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: false, processed: 0, remaining: null, rateLimited: { retryAfterSec: 321 } });
    expect(deps.store.conns.get("u1")!.sync_cursor?.lease_until).toBeUndefined();
  });

  it("a refresh rejected for config reasons returns config_error and deletes nothing", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ expires_at: NOW_SEC - 1, sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.fail("refresh", new StravaHttpError(401, null, false));
    const res = await handleSync(syncReq(), deps);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe("config_error");
    expect(deps.store.conns.has("u1")).toBe(true);
  });

  it("an invalid_grant refresh is strava_revoked and deletes the connection", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ expires_at: NOW_SEC - 1, sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.fail("refresh", new StravaHttpError(400, null, true));
    const res = await handleSync(syncReq(), deps);
    expect(((await res.json()) as { error: string }).error).toBe("strava_revoked");
    expect(deps.store.conns.has("u1")).toBe(false);
  });

  it("returns upstream_error 502 when Strava fails and nothing was processed", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.fail("list:1", new StravaHttpError(500), new StravaHttpError(500));
    const res = await handleSync(syncReq(), deps);
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe("upstream_error");
  });
});

describe("disconnect", () => {
  const req = (body: unknown) => authed(`${BASE}/api/strava/disconnect`, body);

  it("deauthorizes, deletes the connection and keeps activities by default", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    const res = await handleDisconnect(req({}), deps);
    expect(await res.json()).toEqual({ deauthorized: true });
    expect(deps.strava.calls).toEqual(["deauth:acc-old"]);
    expect(deps.store.conns.size).toBe(0);
    expect(deps.store.deletedStravaActivities).toEqual([]);
  });

  it("deletes Strava activities when asked, even if deauthorize fails", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.strava.fail("deauth", new StravaHttpError(500));
    const res = await handleDisconnect(req({ deleteActivities: true }), deps);
    expect(await res.json()).toEqual({ deauthorized: false });
    expect(deps.store.conns.size).toBe(0);
    expect(deps.store.deletedStravaActivities).toEqual(["u1"]);
  });
});

describe("webhook GET", () => {
  const get = (q: string) => handleWebhookGet(new Request(`${BASE}/api/strava/webhook?${q}`), makeDeps());

  it("echoes the challenge when mode and token match", async () => {
    const res = get("hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=xyz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "hub.challenge": "xyz" });
  });
  it("403 for a wrong token, wrong mode or missing token", () => {
    expect(get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=xyz").status).toBe(403);
    expect(get("hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=xyz").status).toBe(403);
    expect(get("hub.mode=subscribe&hub.challenge=xyz").status).toBe(403);
  });
});

describe("webhook POST routing", () => {
  const post = async (deps: ReturnType<typeof makeDeps>, body: string) => {
    const pending: Promise<unknown>[] = [];
    const res = await handleWebhookPost(
      new Request(`${BASE}/api/strava/webhook`, { method: "POST", body }),
      deps,
      (p) => pending.push(p),
    );
    await Promise.all(pending);
    return res;
  };
  const ev = (o: Record<string, unknown>) => JSON.stringify({ owner_id: 42, object_type: "activity", ...o });

  it("create and update fetch and store that one activity", async () => {
    for (const aspect of ["create", "update"]) {
      const deps = makeDeps();
      deps.store.add(makeConn());
      const res = await post(deps, ev({ aspect_type: aspect, object_id: 777 }));
      expect(res.status).toBe(200);
      expect(deps.store.upserts.map((r) => r.strava_id)).toEqual([777]);
      expect(deps.store.zones.size).toBe(1);
    }
  });

  it("refreshes an expiring token first", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ expires_at: NOW_SEC - 5 }));
    await post(deps, ev({ aspect_type: "create", object_id: 1 }));
    expect(deps.strava.calls[0]).toBe("refresh:ref-old");
    expect(deps.store.tokenUpdates).toHaveLength(1);
  });

  it("webhook processing marks duplicates too", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.store.manual = [{ id: "m1", activity_type_id: 1, start_time: new Date(NOW_SEC * 1000 - 3600_000).toISOString(), source: "manual" }];
    await post(deps, ev({ aspect_type: "create", object_id: 1 }));
    expect(deps.store.dupSets[0][1]).toBe("m1");
  });

  it("delete removes the row only when Strava answers 404 for the activity", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.strava.fail("detail:777", new StravaHttpError(404));
    await post(deps, ev({ aspect_type: "delete", object_id: 777 }));
    expect(deps.store.deletedByStravaId).toEqual([["u1", 777]]);
  });

  it("a forged delete is ignored when the activity still exists or verification fails", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    await post(deps, ev({ aspect_type: "delete", object_id: 1 })); // Strava returns the activity
    deps.strava.fail("detail:2", new StravaHttpError(500));
    await post(deps, ev({ aspect_type: "delete", object_id: 2 })); // 5xx
    deps.strava.fail("detail:3", new StravaHttpError(0));
    await post(deps, ev({ aspect_type: "delete", object_id: 3 })); // network
    expect(deps.store.deletedByStravaId).toEqual([]);
  });

  it("athlete deauthorization deletes only the connection, and only when Strava answers 401", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.strava.fail("athlete", new StravaHttpError(401));
    await post(deps, ev({ object_type: "athlete", aspect_type: "update", object_id: 42, updates: { authorized: "false" } }));
    expect(deps.store.conns.size).toBe(0);
    expect(deps.store.deletedStravaActivities).toEqual([]);
    expect(deps.store.deletedByStravaId).toEqual([]);
  });

  it("a forged deauthorization is ignored when Strava still accepts the token or errors", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    const e = ev({ object_type: "athlete", aspect_type: "update", object_id: 42, updates: { authorized: "false" } });
    await post(deps, e); // GET /athlete succeeds
    deps.strava.fail("athlete", new StravaHttpError(503));
    await post(deps, e);
    expect(deps.store.conns.size).toBe(1);
  });

  it("drops events from another subscription when STRAVA_SUBSCRIPTION_ID is set (string compare)", async () => {
    const deps = makeDeps();
    deps.config.subscriptionId = "555";
    deps.store.add(makeConn());
    const a = await post(deps, ev({ aspect_type: "create", object_id: 1, subscription_id: 999 }));
    const b = await post(deps, ev({ aspect_type: "create", object_id: 2 }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(deps.store.upserts).toEqual([]);
    await post(deps, ev({ aspect_type: "create", object_id: 3, subscription_id: 555 }));
    expect(deps.store.upserts.map((r) => r.strava_id)).toEqual([3]);
  });

  it("an update for an activity that is now 404 leaves the stored row alone and does not crash", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.strava.fail("detail:9", new StravaHttpError(404));
    const res = await post(deps, ev({ aspect_type: "update", object_id: 9 }));
    expect(res.status).toBe(200);
    expect(deps.store.upserts).toEqual([]);
    expect(deps.store.deletedByStravaId).toEqual([]);
  });

  it("insert-vs-update race: an activity inserted between lookup and write keeps its id (zones attach to it)", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.store.activities.set("raced-id", { id: "raced-id", user_id: "u1", strava_id: 5 } as never);
    // Hide the row from the lookup so the engine believes the activity is new.
    const realFind = deps.store.findStravaActivities.bind(deps.store);
    deps.store.findStravaActivities = async () => [];
    await post(deps, ev({ aspect_type: "create", object_id: 5 }));
    deps.store.findStravaActivities = realFind;
    expect(deps.store.activities.size).toBe(1);
    expect([...deps.store.zones.keys()]).toEqual(["raced-id"]);
    expect(deps.store.activities.get("raced-id")?.name).toBe("Run 5");
  });

  it("athlete updates other than deauthorization are ignored", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    await post(deps, ev({ object_type: "athlete", aspect_type: "update", object_id: 42, updates: { title: "x" } }));
    expect(deps.store.conns.size).toBe(1);
  });

  it("unknown owner is ignored silently", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    const res = await post(deps, ev({ owner_id: 999, aspect_type: "create", object_id: 1 }));
    expect(res.status).toBe(200);
    expect(deps.strava.calls).toEqual([]);
    expect(deps.store.upserts).toEqual([]);
  });

  it("malformed or odd bodies still return 200", async () => {
    const deps = makeDeps();
    for (const b of ["{not json", "", "null", "[]", '"str"']) {
      expect((await post(deps, b)).status).toBe(200);
    }
    expect(deps.strava.calls).toEqual([]);
  });

  it("never throws out of the event processor", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn());
    deps.strava.fail("detail:5", new StravaHttpError(500), new StravaHttpError(500));
    await expect(processWebhookEvent(deps, { object_type: "activity", aspect_type: "create", owner_id: 42, object_id: 5 })).resolves.toBeUndefined();
    expect(deps.logs.some((l) => /status=500/.test(l))).toBe(true);
  });
});

describe("auth and methods", () => {
  it("401 for missing and invalid bearer tokens on every authenticated handler", async () => {
    const deps = makeDeps();
    const handlers = [handleConnect, handleSync, handleDisconnect];
    for (const h of handlers) {
      const none = await h(new Request(`${BASE}/x`, { method: "POST" }), deps);
      expect(none.status).toBe(401);
      const bad = await h(
        new Request(`${BASE}/x`, { method: "POST", headers: { Authorization: "Bearer wrong" } }),
        deps,
      );
      expect(bad.status).toBe(401);
      expect(((await bad.json()) as { error: string }).error).toBe("unauthenticated");
    }
    expect(deps.store.conns.size).toBe(0);
  });

  it("handlers return 405 for wrong methods", async () => {
    const deps = makeDeps();
    for (const h of [handleConnect, handleSync, handleDisconnect]) {
      expect((await h(new Request(`${BASE}/x`, { method: "GET" }), deps)).status).toBe(405);
    }
    expect((await handleCallback(new Request(`${BASE}/x`, { method: "POST" }), deps)).status).toBe(405);
    expect((await handleWebhookPost(new Request(`${BASE}/x`, { method: "GET" }), deps, () => undefined)).status).toBe(405);
  });

  it("route modules answer 405 for non-matching methods and expose method handlers", async () => {
    const ctx = (method: string) => ({ request: new Request(`${BASE}/x`, { method }) }) as never;
    const cases: Array<[{ onRequest: unknown }, string]> = [
      [connectRoute, "GET"],
      [syncRoute, "GET"],
      [disconnectRoute, "PUT"],
      [callbackRoute, "POST"],
      [webhookRoute, "DELETE"],
    ];
    for (const [route, method] of cases) {
      const res = (await (route.onRequest as (c: never) => Response)(ctx(method))) as Response;
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBeTruthy();
    }
    expect(typeof connectRoute.onRequestPost).toBe("function");
    expect(typeof syncRoute.onRequestPost).toBe("function");
    expect(typeof disconnectRoute.onRequestPost).toBe("function");
    expect(typeof callbackRoute.onRequestGet).toBe("function");
    expect(typeof webhookRoute.onRequestGet).toBe("function");
    expect(typeof webhookRoute.onRequestPost).toBe("function");
  });

  it("route POST without a bearer token is 401 before any backend is touched", async () => {
    const env = { SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", STRAVA_CLIENT_ID: "c", STRAVA_CLIENT_SECRET: "x", STRAVA_WEBHOOK_VERIFY_TOKEN: "v", STRAVA_STATE_SECRET: "y" };
    const ctx = { request: new Request(`${BASE}/x`, { method: "POST" }), env } as never;
    for (const route of [connectRoute, syncRoute, disconnectRoute]) {
      const res = await (route.onRequestPost as (c: never) => Promise<Response>)(ctx);
      expect(res.status).toBe(401);
    }
  });

  it("logs never contain tokens", async () => {
    const deps = makeDeps();
    deps.store.add(makeConn({ sync_cursor: { mode: "initial", after: 1, page: 1, pending: [] } }));
    deps.strava.pages = [[1]];
    deps.strava.fail("detail:1", new StravaHttpError(500), new StravaHttpError(500));
    await handleSync(authed(`${BASE}/s`, {}), deps);
    expect(deps.logs.join(" ")).not.toMatch(/acc-old|ref-old|good/);
  });
});

