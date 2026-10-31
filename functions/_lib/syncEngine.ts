/** Batch sync algorithm. Pure of HTTP and DB: everything goes through the injected Strava client and Store. */
import {
  buildActivityFromStrava,
  defaultMaxHr,
  findDuplicateCandidates,
  isTokenExpiring,
  timeInHrZones,
} from "@fittrack/shared";
import type { StravaBuildContext, SyncResult } from "@fittrack/shared";
import { StravaHttpError } from "./strava";
import type { StravaClient } from "./strava";
import type { Connection, ExistingActivity, Store, SyncCursor } from "./store";

export const BATCH_SIZE = 15;
export const PAGE_SIZE = 30;
/** Outbound fetches (Strava + Supabase) allowed per invocation; the platform limit is about 50. */
export const MAX_FETCHES = 45;
/** Worst case fetches for one activity: detail, stream, lookup, upsert, zones, near, set duplicate, cursor save. */
export const PER_ACTIVITY_RESERVE = 8;
export const LEASE_MS = 60_000;
export const INITIAL_DAYS = 90;
const DUP_WINDOW_MIN = 30;

export interface EngineDeps {
  store: Store;
  strava: StravaClient;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
  /** Outbound fetches used so far in this invocation. */
  used(): number;
  maxFetches?: number;
  /** Safe logger: callers must never pass secrets. */
  log?(msg: string): void;
}

/** The user revoked access at Strava (or the refresh token was rejected). */
export class RevokedError extends Error {
  constructor() {
    super("Strava access was revoked");
    this.name = "RevokedError";
  }
}

/** Strava is failing (5xx / network) and nothing could be done. */
export class UpstreamError extends Error {
  constructor() {
    super("Strava is unavailable");
    this.name = "UpstreamError";
  }
}

export function initialCursor(nowSec: number): SyncCursor {
  return { mode: "initial", after: nowSec - INITIAL_DAYS * 86400, page: 1, pending: [] };
}

/** Builds the cursor a sync starts from, given the stored one and the mode the caller asked for. */
export function prepareCursor(
  requested: "initial" | "incremental" | undefined,
  lastSyncAt: string | null,
  nowSec: number,
): (current: SyncCursor | null) => SyncCursor {
  return (current) => {
    const inProgress = current && typeof current.after === "number";
    // A cursor with `after` is a run in progress (or the fresh post-OAuth cursor): always continue it, any mode.
    if (inProgress) {
      return { ...current, page: current.page ?? 1, pending: current.pending ?? [] };
    }
    const mode = requested ?? (current ? "incremental" : "initial");
    if (mode === "initial") return initialCursor(nowSec);
    const last = lastSyncAt ? Math.floor(Date.parse(lastSyncAt) / 1000) : NaN;
    const after = Number.isFinite(last) ? last - 86400 : nowSec - INITIAL_DAYS * 86400;
    return { mode: "incremental", after, page: 1, pending: [] };
  };
}

/** Retries a Strava call once after a short delay on 5xx / network errors. */
async function withRetry<T>(deps: EngineDeps, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof StravaHttpError && (e.status >= 500 || e.status === 0)) {
      await deps.sleep(500);
      return await fn();
    }
    throw e;
  }
}

/** Refreshes the access token when it expires within 5 minutes; persists BOTH new tokens. */
export async function ensureFreshToken(deps: EngineDeps, conn: Connection): Promise<Connection> {
  const nowSec = Math.floor(deps.nowMs() / 1000);
  if (!isTokenExpiring(conn.expires_at, nowSec)) return conn;
  let t;
  try {
    t = await deps.strava.refreshToken(conn.refresh_token);
  } catch (e) {
    if (e instanceof StravaHttpError && (e.status === 400 || e.status === 401)) throw new RevokedError();
    throw e;
  }
  const next = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
  await deps.store.updateTokens(conn.user_id, next);
  return { ...conn, ...next };
}

export interface ProcessContext {
  userId: string;
  typeIdByName: StravaBuildContext["typeIdByName"];
  metByTypeId: StravaBuildContext["metByTypeId"];
  weightKg: number | null;
  maxHr: number;
}

export async function loadProcessContext(deps: EngineDeps, userId: string): Promise<ProcessContext> {
  const [types, profile] = await Promise.all([deps.store.listActivityTypes(), deps.store.getProfile(userId)]);
  const typeIdByName: ProcessContext["typeIdByName"] = {};
  const metByTypeId: ProcessContext["metByTypeId"] = {};
  for (const t of types) {
    typeIdByName[t.name] = t.id;
    metByTypeId[t.id] = { met_light: t.met_light, met_moderate: t.met_moderate, met_vigorous: t.met_vigorous };
  }
  let maxHr = profile?.max_hr ?? null;
  if (maxHr == null) {
    const dob = profile?.dob ? Date.parse(profile.dob) : NaN;
    if (Number.isFinite(dob)) {
      const age = Math.floor((deps.nowMs() - dob) / (365.25 * 86400_000));
      maxHr = age > 0 && age < 120 ? defaultMaxHr(age) : 190;
    } else {
      maxHr = 190;
    }
  }
  return { userId, typeIdByName, metByTypeId, weightKg: profile?.weight_kg ?? null, maxHr };
}

type Outcome = "written" | "gone";

/**
 * Fetches one activity and stores it with HR zones and duplicate marking.
 * `existing`: the stored row (or null when new); undefined means "look it up".
 * Throws StravaHttpError (429 / 5xx / ...), RevokedError for a 401.
 */
export async function processActivity(
  deps: EngineDeps,
  pctx: ProcessContext,
  accessToken: string,
  stravaId: number,
  existing: ExistingActivity | null | undefined,
): Promise<Outcome> {
  const { store, strava } = deps;
  let detail;
  try {
    detail = await withRetry(deps, () => strava.getActivity(accessToken, stravaId));
  } catch (e) {
    if (e instanceof StravaHttpError) {
      if (e.status === 401) throw new RevokedError();
      // Deleted or no longer visible: nothing to store.
      if (e.status === 404 || e.status === 403) return "gone";
    }
    throw e;
  }

  let stream = null;
  if (detail.has_heartrate) {
    try {
      stream = await withRetry(deps, () => strava.getHrStream(accessToken, stravaId));
    } catch (e) {
      if (e instanceof StravaHttpError) {
        if (e.status === 401) throw new RevokedError();
        if (e.status === 429) throw e;
        stream = null; // zones are optional; keep the activity
      } else {
        throw e;
      }
    }
  }

  if (existing === undefined) {
    existing = (await store.findStravaActivities(pctx.userId, [stravaId]))[0] ?? null;
  }
  const row = buildActivityFromStrava(detail, {
    userId: pctx.userId,
    typeIdByName: pctx.typeIdByName,
    metByTypeId: pctx.metByTypeId,
    weightKg: pctx.weightKg,
    maxHr: pctx.maxHr,
    id: existing?.id ?? crypto.randomUUID(),
  });
  const activityId = await store.upsertStravaActivity(row);

  if (stream) {
    const z = timeInHrZones(stream, pctx.maxHr);
    await store.upsertHrZones({
      activity_id: activityId,
      user_id: pctx.userId,
      zone1_s: Math.round(z[0]),
      zone2_s: Math.round(z[1]),
      zone3_s: Math.round(z[2]),
      zone4_s: Math.round(z[3]),
      zone5_s: Math.round(z[4]),
      max_hr_used: pctx.maxHr,
    });
  }

  const canMark = !existing || (existing.duplicate_of === null && !existing.duplicate_dismissed);
  if (canMark) {
    const near = await store.findManualActivitiesNear(pctx.userId, row.start_time, DUP_WINDOW_MIN);
    const candidates = findDuplicateCandidates(
      { id: activityId, activity_type_id: row.activity_type_id, start_time: row.start_time, source: "strava" },
      near.filter((n) => n.source === "manual"),
      DUP_WINDOW_MIN,
    );
    if (candidates.length > 0) await store.setDuplicateOf(pctx.userId, activityId, candidates[0]);
  }
  return "written";
}

/** Used by the webhook: process exactly one activity for a connection. */
export async function syncSingleActivity(deps: EngineDeps, conn: Connection, stravaId: number): Promise<Outcome> {
  const fresh = await ensureFreshToken(deps, conn);
  const pctx = await loadProcessContext(deps, conn.user_id);
  return processActivity(deps, pctx, fresh.access_token, stravaId, undefined);
}

function withoutLease(c: SyncCursor): SyncCursor {
  const rest = { ...c };
  delete rest.lease_until;
  return rest;
}

/**
 * Runs one batch. `conn` must carry fresh tokens and `cursor` is the leased cursor.
 * Persists the cursor after every activity and releases the lease at the end.
 */
export async function runSyncBatch(deps: EngineDeps, conn: Connection, cursor: SyncCursor): Promise<SyncResult> {
  const { store, strava } = deps;
  const uid = conn.user_id;
  const maxFetches = deps.maxFetches ?? MAX_FETCHES;
  const cur: SyncCursor = {
    mode: cursor.mode,
    after: cursor.after,
    page: cursor.page ?? 1,
    pending: [...(cursor.pending ?? [])],
  };
  const pending = cur.pending as number[];
  let processed = 0;
  let revoked = false;
  let finalSync: string | undefined;
  const known = new Map<number, ExistingActivity>();
  const checked = new Set<number>();

  const saveLeased = () => store.saveCursor(uid, { ...cur, lease_until: deps.nowMs() + LEASE_MS });
  const partial = (): SyncResult => ({ done: false, processed, remaining: pending.length > 0 ? pending.length : null });
  const limited = (retryAfterSec: number): SyncResult => ({
    done: false,
    processed,
    remaining: pending.length > 0 ? pending.length : null,
    rateLimited: { retryAfterSec },
  });
  const ensureKnown = async (ids: number[]) => {
    const need = ids.filter((i) => !checked.has(i));
    if (need.length === 0) return;
    for (const r of await store.findStravaActivities(uid, need)) known.set(r.strava_id, r);
    for (const i of need) checked.add(i);
  };

  try {
    const pctx = await loadProcessContext(deps, uid);
    for (;;) {
      if (processed >= BATCH_SIZE) return partial();
      const rl = strava.rateLimit();
      if (rl.exhausted) return limited(rl.retryAfterSec);

      try {
        if (pending.length === 0) {
          if (deps.used() + 2 > maxFetches) return partial();
          const items = await withRetry(deps, () =>
            strava.listActivities(conn.access_token, {
              after: cur.after ?? 0,
              page: cur.page ?? 1,
              perPage: PAGE_SIZE,
            }),
          );
          if (items.length === 0) {
            finalSync = new Date(deps.nowMs()).toISOString();
            return { done: true, processed, remaining: 0 };
          }
          let ids = [...new Set(items.map((i) => i.id))]; // never assume list order
          await ensureKnown(ids);
          if (cur.mode === "initial") ids = ids.filter((i) => !known.has(i));
          pending.push(...ids);
          cur.page = (cur.page ?? 1) + 1;
          await saveLeased();
          continue;
        }

        if (deps.used() + PER_ACTIVITY_RESERVE > maxFetches) return partial();
        await ensureKnown(pending);
        const id = pending[0];
        const outcome = await processActivity(deps, pctx, conn.access_token, id, known.get(id) ?? null);
        pending.shift();
        if (outcome === "written") processed++;
        await saveLeased();
      } catch (e) {
        if (e instanceof RevokedError) throw e;
        if (e instanceof StravaHttpError) {
          if (e.status === 401) throw new RevokedError();
          if (e.status === 429) return limited(e.retryAfterSec ?? 60);
          if (e.status >= 500 || e.status === 0) {
            if (processed === 0) throw new UpstreamError();
            return partial();
          }
          throw new UpstreamError();
        }
        throw e;
      }
    }
  } catch (e) {
    if (e instanceof RevokedError) {
      revoked = true;
      await store.deleteConnection(uid);
    }
    throw e;
  } finally {
    if (!revoked) {
      try {
        if (finalSync) {
          await store.saveCursor(uid, { mode: "incremental" }, { lastSyncAt: finalSync });
        } else {
          await store.saveCursor(uid, withoutLease(cur));
        }
      } catch {
        deps.log?.("sync: could not release lease");
      }
    }
  }
}
