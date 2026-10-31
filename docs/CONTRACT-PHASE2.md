# Phase 2 Contract (Strava)

Agents code against this document. FROZEN: this file, `packages/shared/src/stravaTypes.ts`, `src/lib/database.types.ts`, `src/lib/strava.ts`. If something looks wrong, report it instead of editing.
Phase 1 rules in `docs/CONTRACT.md` and the skill's non-negotiable rules still apply.

## File ownership

| Owner | Paths |
|---|---|
| DB agent | `supabase/migrations/0006_*.sql` (and any later numbered file it needs), `supabase/tests/**`, `supabase/README.md` |
| Shared agent | `packages/shared/src/strava.ts`, `packages/shared/src/strava.test.ts`, and the one-line `export * from "./strava";` in `packages/shared/src/index.ts` (`calc.ts` and the types files stay untouched) |
| Worker agent | `functions/**`, `wrangler.toml`, `.dev.vars.example` |
| Frontend agent | `src/features/**` (all features; it is the only agent editing them in Phase 2) |
| Orchestrator | everything else (`src/lib/**`, `src/components/**`, `src/App.tsx`, config, docs, README, `.env.example`) |

## Architecture decisions

1. **Tokens never reach the browser.** `strava_connections` has RLS enabled and forced, no policies for `anon`/`authenticated`, all privileges revoked from them. Only the Worker (service-role key) reads or writes it. The browser reads connection status through the RPC `public.strava_status()`.
2. **Batched sync.** Cloudflare free plan allows about 50 subrequests per invocation, so a sync call processes one batch (at most 15 activities: each needs a detail call and a HR-stream call) and returns progress. The browser calls it again until `done`. The cursor lives in `strava_connections.sync_cursor`.
3. **Rate limits.** The Worker tracks Strava's `X-RateLimit-*` headers; on HTTP 429 (or when the 15-minute usage is at its limit) it stops, saves the cursor and returns `rateLimited: { retryAfterSec }`. The browser waits and retries. Within a batch, retry transient 5xx once with a short delay.
4. **Duplicates are hidden, not deleted.** A Strava row that overlaps a manual row (same `activity_type_id`, `start_time` within +/-30 minutes) gets `duplicate_of = <manual row id>`. "Keep Strava" deletes the manual row. "Keep manual" sets `excluded = true` on the Strava row (so a webhook or re-sync cannot recreate it). "Not a duplicate" sets `duplicate_dismissed = true`. Excluded rows are ignored by `daily_summaries` and hidden from lists. Worker upserts by `strava_id` must **never overwrite** `notes`, `excluded`, `duplicate_dismissed`.
5. **Manual rows win nothing automatically.** Calories: Strava `calories` if present (`calories_estimated = false`), else MET estimate using the profile weight (`calories_estimated = true`).
6. **Webhook** must answer within 2 seconds: validate, respond 200, process with `ctx.waitUntil`. Events: activity `create`/`update` (fetch and upsert that activity), activity `delete` (delete the row by `strava_id`), athlete `update` with `updates.authorized === "false"` (delete the connection; keep activities).
7. **OAuth state** is an HMAC-SHA256 signed token (`STRAVA_STATE_SECRET`) carrying `{ uid, exp }` (10 minute expiry). The callback verifies it before exchanging the code.
8. **Auth to the Worker:** `Authorization: Bearer <supabase access token>`; verify with `supabase.auth.getUser(token)` using the anon client. Never trust a `user_id` from the request body.

## Database additions (`0006_strava.sql`)

`activities` gains (all nullable unless stated): `name text`, `elevation_m numeric`, `suffer_score integer`, `moving_time_s integer`, `elapsed_time_s integer`, `excluded boolean not null default false`, `duplicate_dismissed boolean not null default false`. `duplicate_of` (already present) becomes a real FK to `activities(id)` with `on delete set null`.

`strava_connections`: `user_id uuid primary key references auth.users on delete cascade`, `athlete_id bigint not null unique`, `access_token text not null`, `refresh_token text not null`, `expires_at timestamptz not null`, `scope text`, `last_sync_at timestamptz`, `sync_cursor jsonb`, `created_at`, `updated_at`.

`activity_hr_zones`: `activity_id uuid primary key references activities(id) on delete cascade`, `user_id uuid not null`, `zone1_s`..`zone5_s integer not null default 0`, `max_hr_used integer not null`, `created_at`. RLS: owner select/insert/update/delete.

RPC `strava_status()` (security definer, `search_path = public`): returns one row `{ connected boolean, athlete_id bigint, last_sync_at timestamptz, scope text }` for `auth.uid()`; grant execute to `authenticated` only.

`recompute_daily_summary` must ignore rows where `excluded = true`.

Migration `0007_strava_id_unique.sql` (already written) replaces the partial unique index on `activities.strava_id` with a plain one, so the Worker can upsert with `onConflict: "strava_id"`. On conflict it must update only the Strava-owned columns (the shared builder never includes `notes`, `excluded`, `duplicate_dismissed`, `duplicate_of`).

## Worker API (`functions/api/strava/*`, Cloudflare Pages Functions, TypeScript)

All JSON. Errors: `{ "error": "<code>", "message": "<text>" }` with a suitable HTTP status. Types are in `src/lib/strava.ts`.

| Route | Auth | Behaviour |
|---|---|---|
| `POST /api/strava/connect` | Bearer | Returns `{ url }`, the Strava authorize URL (`client_id`, `redirect_uri = <origin>/api/strava/callback`, `response_type=code`, `approval_prompt=auto`, `scope=read,activity:read_all`, `state`). |
| `GET /api/strava/callback?code&state&scope&error` | state | Verify state, require `activity:read_all` in granted scope, exchange the code, upsert `strava_connections` (reset `sync_cursor` to an initial 90-day cursor), 302 to `/settings?strava=connected`. On failure 302 to `/settings?strava=error&reason=<code>`. |
| `POST /api/strava/sync` body `{ "mode"?: "initial" \| "incremental" }` | Bearer | Refresh the token when it expires within 5 minutes, process one batch, return `SyncResult`. `initial` = the last 90 days (default when a cursor exists); `incremental` = since `last_sync_at` minus 1 day. |
| `POST /api/strava/disconnect` body `{ "deleteActivities"?: boolean }` | Bearer | Call Strava `POST /oauth/deauthorize`, delete the connection row, optionally delete `source = 'strava'` activities. Succeed even if Strava deauthorize fails (report `deauthorized: false`). |
| `GET /api/strava/webhook` | verify token | Strava subscription validation: echo `{ "hub.challenge": ... }` when `hub.verify_token` equals `STRAVA_WEBHOOK_VERIFY_TOKEN`, else 403. |
| `POST /api/strava/webhook` | none (Strava) | See decision 6. Always return 200 quickly. |

Environment (Worker secrets / `.dev.vars`): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, `STRAVA_STATE_SECRET`.

The Worker code must be testable without network: put Strava HTTP in a small client module and persistence in a store module, both injected into the handlers, and unit test with fakes (token refresh, 429 handling, batching and cursor, webhook routing, state signing/verification, duplicate marking, never overwriting `notes`/`excluded`).

## Shared module additions (`packages/shared/src/strava.ts`, pure, exported from the package index)

```ts
isTokenExpiring(expiresAtSec: number, nowSec: number, skewSec?: number): boolean        // default skew 300
mapStravaSport(sportType: string): { typeName: string; custom: string | null }          // to a seeded activity_types name; unknown -> Other + custom name
intensityFromHr(avgHr: number | null, maxHr: number | null): Intensity                  // <60% light, <80% moderate, else vigorous; no data -> moderate
timeInHrZones(stream: StravaHrStream, maxHr: number): [number, number, number, number, number]  // seconds per zone, uses sample time deltas, ignores bad samples
buildActivityFromStrava(d: StravaDetailedActivity, ctx: { userId: string; typeIdByName: Record<string, number>; metByTypeId: Record<number, { met_light: number; met_moderate: number; met_vigorous: number }>; weightKg: number | null; maxHr: number | null; id: string }): StravaActivityUpsert
findDuplicateCandidates(target: { id: string; activity_type_id: number; start_time: string }, others: Array<{ id: string; activity_type_id: number; start_time: string; source: ActivitySource }>, windowMin?: number): string[]  // ids within +/-30 min, same type, opposite source
retryAfterSeconds(headers: { retryAfter?: string | null; usage?: string | null; limit?: string | null }, nowSec?: number): number    // Retry-After or time to next 15-minute window
```

`StravaActivityUpsert` is the row to upsert into `activities` (see `stravaTypes.ts`): never contains `notes`, `excluded` or `duplicate_dismissed`.

## Frontend (Frontend agent)

Uses `src/lib/strava.ts` (`getStravaStatus`, `startStravaConnect`, `runSync`, `disconnectStrava`). Required:
- Onboarding: the Strava option becomes enabled; choosing it sets `activity_tracking_mode = 'strava'` and starts connect after onboarding save. Settings: tracking mode toggle plus a Strava card: status (connected as athlete, last sync time), **Connect Strava**, **Sync now** (loops `runSync` until `done`, shows progress and a countdown when rate limited), **Disconnect** with a choice to also delete synced activities (default: keep). Handle `?strava=connected|error` on return and clear the query string.
- Home and Activity: a sync-status badge when connected (last sync, "syncing", "rate limited, retrying in m:ss", error). Auto-run an incremental sync at most once per 15 minutes when the app opens while connected.
- Activity list: Strava badge, name, elevation, suffer score, avg/max HR; read-only except notes; HR zone bar (zones 1 to 5 with minutes) when `activity_hr_zones` exists; "estimated" tag when `calories_estimated`.
- Duplicate review: rows with `duplicate_of` set and not dismissed show a banner with **Keep Strava**, **Keep manual**, **Not a duplicate** (semantics in decision 4). Hide `excluded` rows from lists and totals.
- Manual activity entry must keep working with no Strava connection at all.
- Max HR used for zones comes from `profiles.max_hr` (editable in Settings; changing it does not rewrite old zone rows).
- Every state: loading, error, empty; dark mode; mobile first; unit tests for new pure logic.
