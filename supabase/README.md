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

## Phase 4 (weekly email)

`0008_email.sql` adds `profiles.email_weekly` / `last_weekly_email_at`, the locked-down `app_config` table (RLS enabled and forced, no policies, no grants for `anon`/`authenticated`) and `public.send_weekly_summaries()`, which queues one `pg_net` request per eligible user (opted in, onboarded, not mailed in 6 days) to the Worker endpoint. A `pg_cron` job `fittrack-weekly-summary` runs it Mondays 02:30 UTC (08:00 IST).

1. Dashboard -> Database -> Extensions: enable `pg_cron` and `pg_net`. If they were off when you ran the migration it only printed a notice; enable them and re-run `0008_email.sql` to create the schedule.
2. Configure the two settings (SQL editor):

```sql
insert into app_config (key, value) values
  ('email_endpoint_url', 'https://YOUR-SITE/api/email/weekly'),
  ('cron_secret', '<same value as the Cloudflare secret CRON_SECRET>')
on conflict (key) do update set value = excluded.value;
```

The secret in `app_config` is only readable by privileged roles (postgres/service role); the browser can never read it. Until both rows exist, `send_weekly_summaries()` does nothing and returns 0.

Checking and operating:

```sql
select * from cron.job;                                                -- job exists
select * from cron.job_run_details order by start_time desc limit 5;   -- recent runs
select public.send_weekly_summaries();                                 -- manual run (returns requests queued)
select * from net._http_response order by created desc limit 5;        -- responses from the Worker
```
