import { describe, expect, it } from "vitest";
import { StravaHttpError } from "./strava";
import {
  BATCH_SIZE,
  RevokedError,
  UpstreamError,
  ensureFreshToken,
  initialCursor,
  prepareCursor,
  runSyncBatch,
} from "./syncEngine";
import { FakeStore, FakeStrava, NOW_MS, NOW_SEC, detail, makeConn, makeDeps } from "./testing";
import type { SyncCursor } from "./store";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function setup(cursor: SyncCursor = initialCursor(NOW_SEC)) {
  const store = new FakeStore();
  const strava = new FakeStrava();
  const deps = makeDeps(store, strava);
  const conn = store.add(makeConn({ sync_cursor: cursor }));
  return { store, strava, deps, conn, cursor };
}

describe("ensureFreshToken", () => {
  it("refreshes an expiring token and persists BOTH tokens", async () => {
    const { store, strava, deps, conn } = setup();
    conn.expires_at = NOW_SEC + 100;
    const fresh = await ensureFreshToken(deps, conn);
    expect(strava.calls).toEqual(["refresh:ref-old"]);
    expect(store.tokenUpdates).toEqual([strava.refreshResult]);
    expect(fresh.access_token).toBe("acc-new");
    expect(fresh.refresh_token).toBe("ref-new");
  });

  it("does nothing when the token is valid", async () => {
    const { store, strava, deps, conn } = setup();
    const same = await ensureFreshToken(deps, conn);
    expect(same).toBe(conn);
    expect(strava.calls).toEqual([]);
    expect(store.tokenUpdates).toEqual([]);
  });

  it("treats a rejected refresh token as revoked", async () => {
    const { strava, deps, conn } = setup();
    conn.expires_at = NOW_SEC - 10;
    strava.fail("refresh", new StravaHttpError(400));
    await expect(ensureFreshToken(deps, conn)).rejects.toBeInstanceOf(RevokedError);
  });
});

describe("prepareCursor", () => {
  it("starts initial for no cursor and incremental after a finished one", () => {
    const a = prepareCursor(undefined, null, NOW_SEC)(null);
    expect(a.mode).toBe("initial");
    expect(a.after).toBe(NOW_SEC - 90 * 86400);
    const last = new Date((NOW_SEC - 7200) * 1000).toISOString();
    const b = prepareCursor(undefined, last, NOW_SEC)({ mode: "incremental" });
    expect(b).toMatchObject({ mode: "incremental", after: NOW_SEC - 7200 - 86400, page: 1, pending: [] });
  });
  it("continues an in-progress cursor for ANY requested mode, never restarting it", () => {
    const cur: SyncCursor = { mode: "initial", after: 5, page: 3, pending: [1, 2] };
    expect(prepareCursor("incremental", null, NOW_SEC)(cur)).toEqual(cur);
    expect(prepareCursor("initial", null, NOW_SEC)(cur)).toEqual(cur);
    const inc: SyncCursor = { mode: "incremental", after: 9, page: 2, pending: [4] };
    expect(prepareCursor("initial", null, NOW_SEC)(inc)).toEqual(inc);
  });
  it("the fresh post-OAuth cursor is continued regardless of mode", () => {
    const fresh = initialCursor(NOW_SEC);
    expect(prepareCursor("incremental", "2026-05-01T00:00:00Z", NOW_SEC)(fresh)).toEqual(fresh);
    expect(prepareCursor(undefined, null, NOW_SEC)(fresh)).toEqual(fresh);
  });
  it("mode only decides how an idle cursor starts", () => {
    const last = new Date((NOW_SEC - 7200) * 1000).toISOString();
    expect(prepareCursor("initial", last, NOW_SEC)({ mode: "incremental" })).toMatchObject({
      mode: "initial",
      after: NOW_SEC - 90 * 86400,
    });
    expect(prepareCursor("incremental", null, NOW_SEC)(null)).toMatchObject({
      mode: "incremental",
      after: NOW_SEC - 90 * 86400,
    });
  });
});

describe("runSyncBatch", () => {
  it("processes at most 15 activities per call and saves the cursor after each", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [range(1, 20)];
    const res = await runSyncBatch(deps, conn, cursor);
    expect(BATCH_SIZE).toBe(15);
    expect(res).toEqual({ done: false, processed: 15, remaining: 5 });
    expect(store.upserts).toHaveLength(15);
    const pendingSeq = store.cursors.map((c) => c.pending?.length);
    // after the page load (20) then one save per activity (19..5), then the lease release
    expect(pendingSeq).toEqual([20, ...range(5, 19).reverse(), 5]);
    const last = store.cursors[store.cursors.length - 1];
    expect(last.pending).toEqual(range(16, 20));
    expect(last.lease_until).toBeUndefined();
    expect(store.conns.get("u1")?.sync_cursor?.lease_until).toBeUndefined();
  });

  it("initial mode skips ids already stored", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1, 2, 3]];
    await store.upsertStravaActivity({ ...(await baseRow(2)), id: "existing-2" });
    store.upserts.length = 0;
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res.processed).toBe(2);
    expect(strava.calls).not.toContain("detail:2");
  });

  it("incremental mode re-fetches known ids and keeps the stored row id", async () => {
    const { store, strava, deps, conn } = setup({ mode: "incremental", after: 1, page: 1, pending: [] });
    strava.pages = [[2]];
    await store.upsertStravaActivity({ ...(await baseRow(2)), id: "existing-2" });
    store.upserts.length = 0;
    const res = await runSyncBatch(deps, conn, { mode: "incremental", after: 1, page: 1, pending: [] });
    expect(res.processed).toBe(1);
    expect(store.upserts[0].id).toBe("existing-2");
  });

  it("pages until an empty page, then marks done and goes incremental", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[3, 1], [2]];
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res).toEqual({ done: true, processed: 3, remaining: 0 });
    expect(strava.calls.filter((c) => c.startsWith("list:"))).toEqual(["list:1", "list:2", "list:3"]);
    const c = store.conns.get("u1")!;
    expect(c.sync_cursor).toEqual({ mode: "incremental" });
    expect(c.last_sync_at).toBe(new Date(NOW_MS).toISOString());
  });

  it("stops on HTTP 429 with the right retryAfterSec and a saved cursor", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1, 2, 3]];
    strava.fail("detail:2", new StravaHttpError(429, 240));
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res).toEqual({ done: false, processed: 1, remaining: 2, rateLimited: { retryAfterSec: 240 } });
    expect(store.conns.get("u1")!.sync_cursor).toMatchObject({ pending: [2, 3] });
    expect(store.conns.get("u1")!.sync_cursor?.lease_until).toBeUndefined();
  });

  it("stops before calling Strava when the usage window is exhausted", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    strava.rate = { exhausted: true, retryAfterSec: 420, usage: "100,10", limit: "100,1000" };
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res).toEqual({ done: false, processed: 0, remaining: null, rateLimited: { retryAfterSec: 420 } });
    expect(strava.calls).toEqual([]);
    expect(store.cursors.length).toBe(1);
  });

  it("retries a transient 5xx once", async () => {
    const { strava, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    strava.fail("detail:1", new StravaHttpError(503));
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res.processed).toBe(1);
    expect(strava.calls.filter((c) => c === "detail:1")).toHaveLength(2);
  });

  it("persistent 5xx: UpstreamError when nothing processed, partial result otherwise", async () => {
    const a = setup();
    a.strava.pages = [[1]];
    a.strava.fail("detail:1", new StravaHttpError(500), new StravaHttpError(500));
    await expect(runSyncBatch(a.deps, a.conn, a.cursor)).rejects.toBeInstanceOf(UpstreamError);
    expect(a.store.conns.get("u1")!.sync_cursor?.pending).toEqual([1]);

    const b = setup();
    b.strava.pages = [[1, 2]];
    b.strava.fail("detail:2", new StravaHttpError(500), new StravaHttpError(500));
    const res = await runSyncBatch(b.deps, b.conn, b.cursor);
    expect(res).toEqual({ done: false, processed: 1, remaining: 1 });
  });

  it("a 401 from Strava deletes the connection", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    strava.fail("detail:1", new StravaHttpError(401));
    await expect(runSyncBatch(deps, conn, cursor)).rejects.toBeInstanceOf(RevokedError);
    expect(store.conns.has("u1")).toBe(false);
  });

  it("skips activities that no longer exist (404)", async () => {
    const { strava, deps, conn, cursor } = setup();
    strava.pages = [[1, 2]];
    strava.fail("detail:1", new StravaHttpError(404));
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res.processed).toBe(1);
  });

  it("stops early when the subrequest budget is used up", async () => {
    const { strava, deps, conn, cursor } = setup();
    strava.pages = [range(1, 10)];
    let used = 0;
    deps.used = () => used;
    const origDetail = strava.getActivity.bind(strava);
    strava.getActivity = async (t, id) => {
      used += 7;
      return origDetail(t, id);
    };
    const res = await runSyncBatch(deps, conn, cursor);
    expect(res.done).toBe(false);
    expect(res.processed).toBeLessThan(10);
    expect(res.processed).toBeGreaterThan(0);
    expect(res.remaining).toBe(10 - res.processed);
  });

  it("stores HR zones with the max HR used (profile, dob fallback, 190 default)", async () => {
    const a = setup();
    a.strava.pages = [[1]];
    await runSyncBatch(a.deps, a.conn, a.cursor);
    const z = [...a.store.zones.values()][0];
    expect(z.max_hr_used).toBe(190);
    expect(z.zone1_s + z.zone2_s + z.zone3_s + z.zone4_s + z.zone5_s).toBeGreaterThan(0);

    const b = setup();
    b.store.profile = { weight_kg: 70, max_hr: null, dob: null };
    b.strava.pages = [[1]];
    await runSyncBatch(b.deps, b.conn, b.cursor);
    expect([...b.store.zones.values()][0].max_hr_used).toBe(190);

    const c = setup();
    c.store.profile = { weight_kg: 70, max_hr: null, dob: "2001-06-01" };
    c.strava.pages = [[1]];
    await runSyncBatch(c.deps, c.conn, c.cursor);
    expect([...c.store.zones.values()][0].max_hr_used).toBe(195);
  });

  it("does not call the stream endpoint without heart rate", async () => {
    const { strava, store, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    strava.details.set(1, detail(1, { has_heartrate: false }));
    await runSyncBatch(deps, conn, cursor);
    expect(strava.calls).not.toContain("stream:1");
    expect(store.zones.size).toBe(0);
  });

  it("upsert payload never contains notes, excluded, duplicate_dismissed or duplicate_of", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1, 2]];
    await runSyncBatch(deps, conn, cursor);
    for (const row of store.upserts) {
      for (const k of ["notes", "excluded", "duplicate_dismissed", "duplicate_of"]) {
        expect(Object.keys(row)).not.toContain(k);
      }
      expect(row.source).toBe("strava");
      expect(row.user_id).toBe("u1");
    }
  });
});

describe("duplicate marking", () => {
  const manualNear = (store: FakeStore, startIso: string) => {
    store.manual = [{ id: "m1", activity_type_id: 1, start_time: startIso, source: "manual" }];
  };

  it("marks a new Strava row that overlaps a manual one", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    manualNear(store, detail(1).start_date);
    await runSyncBatch(deps, conn, cursor);
    expect(store.dupSets).toEqual([[expect.any(String), "m1"]]);
  });

  it("picks the closest manual row", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    const t = Date.parse(detail(1).start_date);
    store.manual = [
      { id: "far", activity_type_id: 1, start_time: new Date(t + 20 * 60_000).toISOString(), source: "manual" },
      { id: "near", activity_type_id: 1, start_time: new Date(t - 2 * 60_000).toISOString(), source: "manual" },
    ];
    await runSyncBatch(deps, conn, cursor);
    expect(store.dupSets[0][1]).toBe("near");
  });

  it("ignores manual rows of another type or outside the window", async () => {
    const { store, strava, deps, conn, cursor } = setup();
    strava.pages = [[1]];
    const t = Date.parse(detail(1).start_date);
    store.manual = [
      { id: "t2", activity_type_id: 2, start_time: detail(1).start_date, source: "manual" },
      { id: "late", activity_type_id: 1, start_time: new Date(t + 45 * 60_000).toISOString(), source: "manual" },
    ];
    await runSyncBatch(deps, conn, cursor);
    expect(store.dupSets).toEqual([]);
  });

  it("does not mark when duplicate_dismissed is true or duplicate_of is already set", async () => {
    for (const state of [
      { duplicate_of: null, duplicate_dismissed: true },
      { duplicate_of: "m0", duplicate_dismissed: false },
    ]) {
      const { store, strava, deps } = setup({ mode: "incremental", after: 1, page: 1, pending: [] });
      const conn = store.conns.get("u1")!;
      strava.pages = [[1]];
      await store.upsertStravaActivity({ ...(await baseRow(1)), id: "existing-1" });
      store.dupState.set(1, state);
      manualNear(store, detail(1).start_date);
      await runSyncBatch(deps, conn, { mode: "incremental", after: 1, page: 1, pending: [] });
      expect(store.dupSets).toEqual([]);
    }
  });
});

async function baseRow(stravaId: number) {
  const { buildActivityFromStrava } = await import("@fittrack/shared");
  return buildActivityFromStrava(detail(stravaId), {
    userId: "u1",
    typeIdByName: { Running: 1, Other: 99 },
    metByTypeId: {},
    weightKg: 70,
    maxHr: 190,
    id: "x",
  });
}
