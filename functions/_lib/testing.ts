/** Hand-written fakes for tests (no network). Not a route; imported only by *.test.ts. */
import type { StravaActivityUpsert, StravaDetailedActivity, StravaHrStream } from "@fittrack/shared";
import type { HandlerDeps } from "./handlers";
import { StravaHttpError } from "./strava";
import type { RateLimitState, StravaClient } from "./strava";
import type {
  Connection,
  ExistingActivity,
  HrZonesRow,
  NearActivity,
  Store,
  SyncCursor,
} from "./store";

export const NOW_MS = Date.UTC(2026, 5, 1, 12, 0, 0);
export const NOW_SEC = Math.floor(NOW_MS / 1000);

export function makeConn(over: Partial<Connection> = {}): Connection {
  return {
    user_id: "u1",
    athlete_id: 42,
    access_token: "acc-old",
    refresh_token: "ref-old",
    expires_at: NOW_SEC + 3600,
    scope: "read,activity:read_all",
    last_sync_at: null,
    sync_cursor: null,
    updated_at: "t0",
    ...over,
  };
}

export function detail(id: number, over: Partial<StravaDetailedActivity> = {}): StravaDetailedActivity {
  return {
    id,
    name: `Run ${id}`,
    type: "Run",
    sport_type: "Run",
    start_date: new Date(NOW_MS - id * 3600_000).toISOString(),
    moving_time: 1800,
    elapsed_time: 1900,
    distance: 5000,
    has_heartrate: true,
    average_heartrate: 150,
    max_heartrate: 175,
    ...over,
  };
}

export class FakeStore implements Store {
  conns = new Map<string, Connection>();
  activities = new Map<string, StravaActivityUpsert & Partial<ExistingActivity> & { notes?: string }>();
  manual: NearActivity[] = [];
  zones = new Map<string, HrZonesRow>();
  cursors: SyncCursor[] = [];
  tokenUpdates: Array<{ access_token: string; refresh_token: string; expires_at: number }> = [];
  deletedStravaActivities: string[] = [];
  deletedByStravaId: Array<[string, number]> = [];
  profile: { weight_kg: number | null; max_hr: number | null; dob: string | null } | null = {
    weight_kg: 70,
    max_hr: 190,
    dob: null,
  };
  /** Per-strava-id flags for existing rows. */
  dupState = new Map<number, { duplicate_of: string | null; duplicate_dismissed: boolean }>();
  dupSets: Array<[string, string]> = [];
  upserts: StravaActivityUpsert[] = [];

  add(conn: Connection) {
    this.conns.set(conn.user_id, conn);
    return conn;
  }
  async getConnection(userId: string) {
    return this.conns.get(userId) ?? null;
  }
  async getConnectionByAthlete(athleteId: number) {
    return [...this.conns.values()].find((c) => c.athlete_id === athleteId) ?? null;
  }
  async upsertConnection(row: Parameters<Store["upsertConnection"]>[0]) {
    this.conns.set(row.user_id, { ...row, last_sync_at: null, updated_at: "t1" });
  }
  async updateTokens(userId: string, t: { access_token: string; refresh_token: string; expires_at: number }) {
    this.tokenUpdates.push(t);
    const c = this.conns.get(userId);
    if (c) Object.assign(c, t);
  }
  async acquireLease(
    conn: Connection,
    nowMs: number,
    leaseMs: number,
    prepare: (c: SyncCursor | null) => SyncCursor,
  ) {
    const c = this.conns.get(conn.user_id);
    if (!c) return null;
    if (c.sync_cursor?.lease_until && c.sync_cursor.lease_until > nowMs) return null;
    c.sync_cursor = { ...prepare(c.sync_cursor), lease_until: nowMs + leaseMs };
    return c.sync_cursor;
  }
  async saveCursor(userId: string, cursor: SyncCursor, opts?: { lastSyncAt?: string }) {
    const c = this.conns.get(userId);
    if (!c) return;
    c.sync_cursor = cursor;
    if (opts?.lastSyncAt) c.last_sync_at = opts.lastSyncAt;
    this.cursors.push(JSON.parse(JSON.stringify(cursor)) as SyncCursor);
  }
  async listActivityTypes() {
    return [
      { id: 1, name: "Running", met_light: 6, met_moderate: 9, met_vigorous: 11 },
      { id: 2, name: "Walking", met_light: 2, met_moderate: 3.5, met_vigorous: 5 },
      { id: 99, name: "Other", met_light: 3, met_moderate: 4, met_vigorous: 6 },
    ];
  }
  async getProfile() {
    return this.profile;
  }
  async findStravaActivities(userId: string, ids: number[]) {
    const out: ExistingActivity[] = [];
    for (const a of this.activities.values()) {
      if (a.user_id === userId && ids.includes(a.strava_id)) {
        const d = this.dupState.get(a.strava_id) ?? { duplicate_of: null, duplicate_dismissed: false };
        out.push({ id: a.id, strava_id: a.strava_id, ...d });
      }
    }
    return out;
  }
  async upsertStravaActivity(row: StravaActivityUpsert) {
    this.upserts.push(row);
    const prev = [...this.activities.values()].find((a) => a.strava_id === row.strava_id);
    const id = prev ? prev.id : row.id;
    this.activities.set(id, { ...(prev ?? {}), ...row, id });
    return id;
  }
  async findManualActivitiesNear() {
    return this.manual;
  }
  async setDuplicateOf(_u: string, activityId: string, manualId: string) {
    this.dupSets.push([activityId, manualId]);
  }
  async upsertHrZones(row: HrZonesRow) {
    this.zones.set(row.activity_id, row);
  }
  async deleteByStravaId(userId: string, stravaId: number) {
    this.deletedByStravaId.push([userId, stravaId]);
  }
  async deleteConnection(userId: string) {
    this.conns.delete(userId);
  }
  async deleteStravaActivities(userId: string) {
    this.deletedStravaActivities.push(userId);
  }
}

export class FakeStrava implements StravaClient {
  calls: string[] = [];
  /** pages[n-1] = ids returned for page n; missing page = empty. */
  pages: number[][] = [];
  details = new Map<number, StravaDetailedActivity>();
  streams = new Map<number, StravaHrStream | null>();
  /** Scripted failures: key is "list:<page>" | "detail:<id>" | "stream:<id>" | "refresh" | "deauth". */
  failures = new Map<string, StravaHttpError[]>();
  refreshResult = { access_token: "acc-new", refresh_token: "ref-new", expires_at: NOW_SEC + 21600 };
  rate: RateLimitState = { exhausted: false, retryAfterSec: 0, usage: null, limit: null };
  detailDelayHook?: (id: number) => void;

  fail(key: string, ...errs: StravaHttpError[]) {
    this.failures.set(key, errs);
  }
  private maybeFail(key: string) {
    const q = this.failures.get(key);
    if (q && q.length > 0) throw q.shift();
  }
  async exchangeCode(code: string) {
    this.calls.push(`exchange:${code}`);
    this.maybeFail("exchange");
    return { access_token: "a1", refresh_token: "r1", expires_at: NOW_SEC + 21600, athlete: { id: 42 } };
  }
  async refreshToken(rt: string) {
    this.calls.push(`refresh:${rt}`);
    this.maybeFail("refresh");
    return this.refreshResult;
  }
  async listActivities(_t: string, o: { after: number; page: number; perPage: number }) {
    this.calls.push(`list:${o.page}`);
    this.maybeFail(`list:${o.page}`);
    return (this.pages[o.page - 1] ?? []).map((id) => ({ id }));
  }
  async getActivity(_t: string, id: number) {
    this.calls.push(`detail:${id}`);
    this.detailDelayHook?.(id);
    this.maybeFail(`detail:${id}`);
    return this.details.get(id) ?? detail(id);
  }
  async getHrStream(_t: string, id: number) {
    this.calls.push(`stream:${id}`);
    this.maybeFail(`stream:${id}`);
    return this.streams.has(id)
      ? (this.streams.get(id) ?? null)
      : { time: [0, 60, 120, 180], heartrate: [100, 120, 150, 170] };
  }
  async deauthorize(t: string) {
    this.calls.push(`deauth:${t}`);
    this.maybeFail("deauth");
  }
  rateLimit() {
    return this.rate;
  }
}

export function makeDeps(
  store = new FakeStore(),
  strava = new FakeStrava(),
  over: Partial<HandlerDeps> = {},
): HandlerDeps & { store: FakeStore; strava: FakeStrava; logs: string[] } {
  const logs: string[] = [];
  return {
    store,
    strava,
    verifyToken: async (t) => (t === "good" ? "u1" : null),
    config: { clientId: "cid", stateSecret: "s3cret-s3cret-s3cret", webhookVerifyToken: "verify-me" },
    nowMs: () => NOW_MS,
    sleep: async () => undefined,
    used: () => 0,
    log: (m) => logs.push(m),
    logs,
    ...over,
  } as HandlerDeps & { store: FakeStore; strava: FakeStrava; logs: string[] };
}

export const authed = (url: string, body?: unknown, method = "POST") =>
  new Request(url, {
    method,
    headers: { Authorization: "Bearer good", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
