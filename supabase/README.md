# FitTrack database (Supabase Postgres)

Migrations in `migrations/` are ordered and safe to re-run on a fresh project:

| File | Purpose |
|---|---|
| 0001_core.sql | tables, CHECKs, indexes, `updated_at` triggers, signup -> empty profile trigger |
| 0002_rls.sql | RLS enabled and forced on every table, per-user policies, read-only reference tables |
| 0003_seed_activity_types.sql | 18 activity types with MET values |
| 0004_seed_foods.sql | ~350 Indian foods per 100 g |
| 0005_daily_summaries.sql | SECURITY DEFINER triggers that recompute `daily_summaries` (IST day) |

## Apply

With the Supabase CLI:

```
supabase link --project-ref <ref>
supabase db push
```

Or open the Supabase dashboard -> SQL editor and paste each file in numeric order.

## Google sign-in reminder

Dashboard -> Authentication -> Providers -> Google: enable it, paste the Google OAuth client ID and secret, and add
the Supabase callback URL (`https://<ref>.supabase.co/auth/v1/callback`) to the authorised redirect URIs in Google Cloud
Console. Also add your app URLs to Authentication -> URL Configuration.

## Tests

No Docker needed; tests run on PGlite (Postgres in WASM).

```
cd supabase/tests
npm install
npm test
```

They stub `auth.users` / `auth.uid()` / roles, apply all migrations (twice, to check idempotency) and assert RLS isolation,
CHECK constraints, the signup trigger, daily summary triggers and seed counts.

## Phase 2 (Strava)

`0006_strava.sql` adds:

- `activities`: `name`, `elevation_m`, `suffer_score`, `moving_time_s`, `elapsed_time_s`, `excluded`, `duplicate_dismissed` (non-negative CHECKs); `duplicate_of` is a real FK (`on delete set null`) with an index.
- `strava_connections`: OAuth tokens. RLS is enabled and forced with no policies and no grants for `anon`/`authenticated`, so tokens are reachable only with the service-role key (Worker side). Clients get connection state from the `strava_status()` RPC, which never returns tokens.
- `activity_hr_zones`: per-activity time in HR zones, owner-only RLS (a zone row must point at the user's own activity).
- `recompute_daily_summary` now ignores `excluded = true` activities.

One-time note: `SUPABASE_SERVICE_ROLE_KEY` goes ONLY into Cloudflare secrets (and the git-ignored `.dev.vars` for local Worker dev). Never put it in `.env.local`, any `VITE_*` variable or the browser.
