-- 0007_strava_id_unique.sql : make strava_id upsert-able
-- ON CONFLICT (strava_id) cannot use a partial index, and the Worker upserts activities by strava_id.
-- A plain unique index still allows many NULLs (manual rows), so uniqueness semantics are unchanged.
drop index if exists public.activities_strava_id_key;
create unique index if not exists activities_strava_id_key on public.activities (strava_id);
