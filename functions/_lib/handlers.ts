/** Request handlers for the Strava routes. Route files only wire these to Pages Functions. */
import type { SyncResult } from "@fittrack/shared";
import {
  bearerToken,
  errorResponse,
  json,
  methodNotAllowed,
  readJsonObject,
  redirect,
} from "./http";
import { signState, timingSafeEqualStr, verifyState } from "./state";
import { REQUIRED_SCOPE, StravaHttpError, buildAuthorizeUrl } from "./strava";
import {
  LEASE_MS,
  RevokedError,
  UpstreamError,
  ensureFreshToken,
  initialCursor,
  prepareCursor,
  runSyncBatch,
  syncSingleActivity,
} from "./syncEngine";
import type { EngineDeps } from "./syncEngine";

export interface HandlerDeps extends EngineDeps {
  verifyToken(token: string): Promise<string | null>;
  config: { clientId: string; stateSecret: string; webhookVerifyToken: string };
}

const nowSec = (d: EngineDeps) => Math.floor(d.nowMs() / 1000);

/** Resolves the caller's user id from the Bearer token, or a 401 response. */
async function authenticate(request: Request, deps: HandlerDeps): Promise<string | Response> {
  const token = bearerToken(request);
  if (!token) return errorResponse(401, "unauthenticated", "Missing bearer token.");
  const uid = await deps.verifyToken(token);
  if (!uid) return errorResponse(401, "unauthenticated", "Invalid or expired session.");
  return uid;
}

function logError(deps: EngineDeps, where: string, e: unknown) {
  // Only the error class and status; never messages that could carry request data.
  const status = e instanceof StravaHttpError ? ` status=${e.status}` : "";
  deps.log?.(`${where}: ${e instanceof Error ? e.name : "error"}${status}`);
}

/* ------------------------------------------------------------------ connect */

export async function handleConnect(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const uid = await authenticate(request, deps);
  if (uid instanceof Response) return uid;
  const origin = new URL(request.url).origin;
  const state = await signState(deps.config.stateSecret, uid, nowSec(deps));
  const url = buildAuthorizeUrl({
    clientId: deps.config.clientId,
    redirectUri: `${origin}/api/strava/callback`,
    state,
  });
  return json({ url });
}

/* ----------------------------------------------------------------- callback */

export async function handleCallback(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed(["GET"]);
  const u = new URL(request.url);
  const fail = (reason: string) => redirect(`${u.origin}/settings?strava=error&reason=${encodeURIComponent(reason)}`);

  const err = u.searchParams.get("error");
  if (err) return fail(err === "access_denied" ? "access_denied" : "oauth_error");

  const uid = await verifyState(deps.config.stateSecret, u.searchParams.get("state") ?? "", nowSec(deps));
  if (!uid) return fail("invalid_state");

  const granted = (u.searchParams.get("scope") ?? "").split(",").map((s) => s.trim());
  if (!granted.includes(REQUIRED_SCOPE)) return fail("missing_scope");

  const code = u.searchParams.get("code");
  if (!code) return fail("missing_code");

  try {
    const t = await deps.strava.exchangeCode(code);
    if (!t.athlete || typeof t.athlete.id !== "number") return fail("exchange_failed");
    await deps.store.upsertConnection({
      user_id: uid,
      athlete_id: t.athlete.id,
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
      scope: granted.join(","),
      sync_cursor: initialCursor(nowSec(deps)),
    });
  } catch (e) {
    logError(deps, "callback", e);
    return fail(e instanceof StravaHttpError ? "exchange_failed" : "store_failed");
  }
  return redirect(`${u.origin}/settings?strava=connected`);
}

/* --------------------------------------------------------------------- sync */

export async function handleSync(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const uid = await authenticate(request, deps);
  if (uid instanceof Response) return uid;

  const body = await readJsonObject(request);
  const mode = body.mode === "initial" || body.mode === "incremental" ? body.mode : undefined;

  try {
    const conn = await deps.store.getConnection(uid);
    if (!conn) return errorResponse(404, "not_connected", "Strava is not connected.");

    const cursor = await deps.store.acquireLease(
      conn,
      deps.nowMs(),
      LEASE_MS,
      prepareCursor(mode, conn.last_sync_at, nowSec(deps)),
    );
    if (!cursor) {
      const busy: SyncResult = { done: false, processed: 0, remaining: null };
      return json(busy);
    }

    let fresh;
    try {
      fresh = await ensureFreshToken(deps, conn);
    } catch (e) {
      if (e instanceof RevokedError) {
        await deps.store.deleteConnection(uid);
      } else {
        // Give the lease back so the next call is not blocked for a minute.
        const { lease_until: _lease, ...rest } = cursor;
        void _lease;
        await deps.store.saveCursor(uid, rest).catch(() => undefined);
      }
      throw e;
    }
    const result = await runSyncBatch(deps, fresh, cursor);
    return json(result);
  } catch (e) {
    return syncErrorResponse(deps, e);
  }
}

function syncErrorResponse(deps: EngineDeps, e: unknown): Response {
  if (e instanceof RevokedError) {
    return errorResponse(403, "strava_revoked", "Strava access was revoked. Please reconnect Strava.");
  }
  if (e instanceof UpstreamError || e instanceof StravaHttpError) {
    logError(deps, "sync", e);
    return errorResponse(502, "upstream_error", "Strava is not responding right now. Try again shortly.");
  }
  logError(deps, "sync", e);
  return errorResponse(500, "internal", "Something went wrong. Please try again.");
}

/* --------------------------------------------------------------- disconnect */

export async function handleDisconnect(request: Request, deps: HandlerDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const uid = await authenticate(request, deps);
  if (uid instanceof Response) return uid;
  const body = await readJsonObject(request);
  const deleteActivities = body.deleteActivities === true;

  try {
    const conn = await deps.store.getConnection(uid);
    let deauthorized = false;
    if (conn) {
      try {
        const fresh = await ensureFreshToken(deps, conn);
        await deps.strava.deauthorize(fresh.access_token);
        deauthorized = true;
      } catch (e) {
        logError(deps, "disconnect", e);
      }
      await deps.store.deleteConnection(uid);
    }
    if (deleteActivities) await deps.store.deleteStravaActivities(uid);
    return json({ deauthorized });
  } catch (e) {
    logError(deps, "disconnect", e);
    return errorResponse(500, "internal", "Could not disconnect. Please try again.");
  }
}

/* ------------------------------------------------------------------ webhook */

export function handleWebhookGet(request: Request, deps: HandlerDeps): Response {
  if (request.method !== "GET") return methodNotAllowed(["GET", "POST"]);
  const p = new URL(request.url).searchParams;
  const mode = p.get("hub.mode");
  const token = p.get("hub.verify_token") ?? "";
  const challenge = p.get("hub.challenge");
  const expected = deps.config.webhookVerifyToken;
  // Compare first so timing does not depend on the mode check.
  const tokenOk = !!expected && timingSafeEqualStr(token, expected);
  if (mode === "subscribe" && tokenOk && challenge !== null) {
    return json({ "hub.challenge": challenge });
  }
  return errorResponse(403, "forbidden", "Verification failed.");
}

interface WebhookEvent {
  object_type?: unknown;
  object_id?: unknown;
  aspect_type?: unknown;
  owner_id?: unknown;
  updates?: Record<string, unknown> | null;
}

/** Never throws. */
export async function processWebhookEvent(deps: HandlerDeps, ev: WebhookEvent): Promise<void> {
  try {
    const owner = Number(ev.owner_id);
    const objectId = Number(ev.object_id);
    if (!Number.isFinite(owner)) return;

    if (ev.object_type === "athlete") {
      if (ev.aspect_type === "update" && ev.updates && String(ev.updates.authorized) === "false") {
        const conn = await deps.store.getConnectionByAthlete(owner);
        if (conn) await deps.store.deleteConnection(conn.user_id);
      }
      return;
    }

    if (ev.object_type !== "activity" || !Number.isFinite(objectId)) return;
    const conn = await deps.store.getConnectionByAthlete(owner);
    if (!conn) return;

    if (ev.aspect_type === "delete") {
      await deps.store.deleteByStravaId(conn.user_id, objectId);
    } else if (ev.aspect_type === "create" || ev.aspect_type === "update") {
      try {
        await syncSingleActivity(deps, conn, objectId);
      } catch (e) {
        if (e instanceof RevokedError) await deps.store.deleteConnection(conn.user_id);
        else throw e;
      }
    }
  } catch (e) {
    logError(deps, "webhook", e);
  }
}

export async function handleWebhookPost(
  request: Request,
  deps: HandlerDeps,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["GET", "POST"]);
  try {
    const ev = (await request.json()) as unknown;
    if (ev && typeof ev === "object" && !Array.isArray(ev)) {
      waitUntil(processWebhookEvent(deps, ev as WebhookEvent));
    }
  } catch {
    // Malformed body: still acknowledge so Strava does not retry.
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
}
