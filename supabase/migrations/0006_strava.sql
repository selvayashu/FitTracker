-- 0006_strava.sql : Strava integration (Phase 2)

-- 1. activities additions ----------------------------------------------------
alter table public.activities
  add column if not exists name text,
  add column if not exists elevation_m numeric,
  add column if not exists suffer_score integer,
  add column if not exists moving_time_s integer,
  add column if not exists elapsed_time_s integer,
  add column if not exists excluded boolean not null default false,
  add column if not exists duplicate_dismissed boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_elevation_m_check') then
    alter table public.activities add constraint activities_elevation_m_check check (elevation_m is null or elevation_m >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_suffer_score_check') then
    alter table public.activities add constraint activities_suffer_score_check check (suffer_score is null or suffer_score >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_moving_time_s_check') then
    alter table public.activities add constraint activities_moving_time_s_check check (moving_time_s is null or moving_time_s >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_elapsed_time_s_check') then
    alter table public.activities add constraint activities_elapsed_time_s_check check (elapsed_time_s is null or elapsed_time_s >= 0);
  end if;
  -- duplicate_of: 0001 already declares an inline FK (on delete set null); add one only if missing
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.activities'::regclass and contype = 'f'
       and confrelid = 'public.activities'::regclass
       and conkey = array[(select attnum from pg_attribute where attrelid = 'public.activities'::regclass and attname = 'duplicate_of')]
  ) then
    alter table public.activities add constraint activities_duplicate_of_fkey
      foreign key (duplicate_of) references public.activities(id) on delete set null;
  end if;
end
$$;

create index if not exists activities_user_duplicate_of_idx on public.activities (user_id, duplicate_of)
  where duplicate_of is not null;
-- unique partial index activities_strava_id_key (0001) is kept as is.

-- 2. strava_connections: tokens, reachable ONLY with the service-role key ------
create table if not exists public.strava_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text,
  last_sync_at timestamptz,
  sync_cursor jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.strava_connections is
  'Strava OAuth tokens. RLS enabled and forced with NO policies and no grants for anon/authenticated: only the service-role key (which bypasses RLS) can read or write. Clients use strava_status().';

alter table public.strava_connections enable row level security;
alter table public.strava_connections force row level security;
revoke all on public.strava_connections from anon, authenticated;

drop trigger if exists strava_connections_updated_at on public.strava_connections;
create trigger strava_connections_updated_at before update on public.strava_connections
  for each row execute function public.set_updated_at();

-- 3. activity_hr_zones -----------------------------------------------------------
create table if not exists public.activity_hr_zones (
  activity_id uuid primary key references public.activities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  zone1_s integer not null default 0 check (zone1_s >= 0),
  zone2_s integer not null default 0 check (zone2_s >= 0),
  zone3_s integer not null default 0 check (zone3_s >= 0),
  zone4_s integer not null default 0 check (zone4_s >= 0),
  zone5_s integer not null default 0 check (zone5_s >= 0),
  max_hr_used integer not null check (max_hr_used > 0),
  created_at timestamptz not null default now()
);
create index if not exists activity_hr_zones_user_id_idx on public.activity_hr_zones (user_id);

alter table public.activity_hr_zones enable row level security;
alter table public.activity_hr_zones force row level security;
drop policy if exists activity_hr_zones_select_own on public.activity_hr_zones;
drop policy if exists activity_hr_zones_insert_own on public.activity_hr_zones;
drop policy if exists activity_hr_zones_update_own on public.activity_hr_zones;
drop policy if exists activity_hr_zones_delete_own on public.activity_hr_zones;
create policy activity_hr_zones_select_own on public.activity_hr_zones
  for select to authenticated using (user_id = (select auth.uid()));
-- the zone row must also point at an activity owned by the same user
create policy activity_hr_zones_insert_own on public.activity_hr_zones
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.activities a where a.id = activity_id and a.user_id = (select auth.uid())));
create policy activity_hr_zones_update_own on public.activity_hr_zones
  for update to authenticated using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.activities a where a.id = activity_id and a.user_id = (select auth.uid())));
create policy activity_hr_zones_delete_own on public.activity_hr_zones
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.activity_hr_zones from anon, authenticated;
grant select, insert, update, delete on public.activity_hr_zones to authenticated;

-- 4. strava_status() : never exposes tokens ----------------------------------------
create or replace function public.strava_status()
returns table (connected boolean, athlete_id bigint, last_sync_at timestamptz, scope text)
language sql
stable
security definer
set search_path = public
as $$
  select true, c.athlete_id, c.last_sync_at, c.scope
    from public.strava_connections c
   where c.user_id = (select auth.uid())
  union all
  select false, null::bigint, null::timestamptz, null::text
   where not exists (select 1 from public.strava_connections c where c.user_id = (select auth.uid()));
$$;
revoke all on function public.strava_status() from public, anon;
grant execute on function public.strava_status() to authenticated;

-- 5. daily summary ignores excluded activities -------------------------------------
create or replace function public.recompute_daily_summary(p_user uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kcal numeric; v_p numeric; v_c numeric; v_f numeric;
  v_active numeric; v_mins numeric; v_workouts integer;
begin
  select coalesce(sum(kcal),0), coalesce(sum(protein),0), coalesce(sum(carbs),0), coalesce(sum(fat),0)
    into v_kcal, v_p, v_c, v_f
    from public.meal_entries where user_id = p_user and date = p_date;

  select coalesce(sum(calories),0), coalesce(sum(duration_min),0), count(*)
    into v_active, v_mins, v_workouts
    from public.activities
   where user_id = p_user
     and excluded = false
     and (start_time at time zone 'Asia/Kolkata')::date = p_date;

  if v_workouts = 0 and not exists (select 1 from public.meal_entries where user_id = p_user and date = p_date) then
    delete from public.daily_summaries where user_id = p_user and date = p_date;
    return;
  end if;

  insert into public.daily_summaries
    (user_id, date, kcal_in, protein_g, carbs_g, fat_g, kcal_active, active_minutes, workouts, updated_at)
  values (p_user, p_date, v_kcal, v_p, v_c, v_f, v_active, v_mins, v_workouts, now())
  on conflict (user_id, date) do update set
    kcal_in = excluded.kcal_in, protein_g = excluded.protein_g, carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g, kcal_active = excluded.kcal_active,
    active_minutes = excluded.active_minutes, workouts = excluded.workouts,
    updated_at = now();
end;
$$;
revoke all on function public.recompute_daily_summary(uuid, date) from public, anon, authenticated;

-- The 0005 trigger is "after insert or update or delete" (any column), so an UPDATE of
-- excluded already recomputes that day; recreate it here so this migration is self-contained.
drop trigger if exists activities_summary on public.activities;
create trigger activities_summary after insert or update or delete on public.activities
  for each row execute function public.trg_activities_summary();
