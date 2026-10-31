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
