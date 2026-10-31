-- 0001_core.sql : core tables, constraints, indexes, triggers (FitTrack Phase 1)

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text,
  sex text check (sex in ('male','female')),
  dob date,
  height_cm numeric check (height_cm between 100 and 250),
  weight_kg numeric check (weight_kg between 20 and 400),
  target_weight_kg numeric check (target_weight_kg between 20 and 400),
  activity_level text check (activity_level in ('sedentary','light','moderate','active','very_active')),
  goal text check (goal in ('lose','maintain','gain')),
  pace numeric check (pace in (0.25, 0.5)),
  bmi_standard text not null default 'asian' check (bmi_standard in ('asian','who')),
  activity_tracking_mode text not null default 'manual' check (activity_tracking_mode in ('strava','manual')),
  exercise_addback_pct numeric not null default 50 check (exercise_addback_pct between 0 and 100),
  max_hr integer check (max_hr between 100 and 230),
  bmi numeric,
  bmr numeric,
  tdee numeric,
  daily_kcal_target numeric,
  protein_target_g numeric,
  carb_target_g numeric,
  fat_target_g numeric,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create an empty profile on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- weight_logs
create table if not exists public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric not null check (weight_kg between 20 and 400),
  bmi numeric,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);
create index if not exists weight_logs_user_date_idx on public.weight_logs (user_id, date desc);

-- ---------------------------------------------------------------- activity_types
create table if not exists public.activity_types (
  id integer primary key,
  name text not null unique,
  met_light numeric not null,
  met_moderate numeric not null,
  met_vigorous numeric not null,
  has_distance boolean not null default false,
  sort_order integer not null default 0
);

-- ---------------------------------------------------------------- activities
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'manual' check (source in ('strava','manual')),
  strava_id bigint,
  activity_type_id integer not null references public.activity_types(id),
  custom_name text,
  start_time timestamptz not null,
  duration_min numeric not null check (duration_min between 1 and 600),
  distance_km numeric check (distance_km is null or distance_km >= 0),
  steps integer check (steps is null or steps >= 0),
  intensity text not null default 'moderate' check (intensity in ('light','moderate','vigorous')),
  avg_hr integer check (avg_hr between 40 and 220),
  max_hr integer check (max_hr between 40 and 220),
  calories numeric check (calories is null or calories >= 0),
  calories_estimated boolean not null default false,
  notes text,
  duplicate_of uuid references public.activities(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists activities_strava_id_key on public.activities (strava_id) where strava_id is not null;
create index if not exists activities_user_start_idx on public.activities (user_id, start_time desc);

drop trigger if exists activities_updated_at on public.activities;
create trigger activities_updated_at before update on public.activities
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- activity_templates
create table if not exists public.activity_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  activity_type_id integer not null references public.activity_types(id),
  duration_min numeric not null check (duration_min between 1 and 600),
  intensity text not null default 'moderate' check (intensity in ('light','moderate','vigorous')),
  created_at timestamptz not null default now()
);
create index if not exists activity_templates_user_idx on public.activity_templates (user_id);

-- ---------------------------------------------------------------- foods
create table if not exists public.foods (
  id integer generated by default as identity primary key,
  name text not null unique,
  kcal_per_100g numeric not null check (kcal_per_100g >= 0),
  protein_per_100g numeric not null default 0 check (protein_per_100g >= 0),
  carbs_per_100g numeric not null default 0 check (carbs_per_100g >= 0),
  fat_per_100g numeric not null default 0 check (fat_per_100g >= 0),
  fibre_per_100g numeric not null default 0 check (fibre_per_100g >= 0),
  serving_label text not null,
  serving_g numeric not null check (serving_g > 0),
  unit_grams jsonb not null default '{}'::jsonb,
  category text
);
create index if not exists foods_name_trgm_idx on public.foods using gin (lower(name) gin_trgm_ops);

-- ---------------------------------------------------------------- custom_foods
create table if not exists public.custom_foods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kcal_per_100g numeric not null check (kcal_per_100g >= 0),
  protein_per_100g numeric not null default 0 check (protein_per_100g >= 0),
  carbs_per_100g numeric not null default 0 check (carbs_per_100g >= 0),
  fat_per_100g numeric not null default 0 check (fat_per_100g >= 0),
  fibre_per_100g numeric not null default 0 check (fibre_per_100g >= 0),
  serving_label text not null default '1 serving',
  serving_g numeric not null default 100 check (serving_g > 0),
  unit_grams jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists custom_foods_user_idx on public.custom_foods (user_id);

-- ---------------------------------------------------------------- meal_entries
create table if not exists public.meal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  meal_type text not null check (meal_type in ('breakfast','lunch','snack','dinner')),
  food_id integer references public.foods(id) on delete set null,
  custom_food_id uuid references public.custom_foods(id) on delete set null,
  external_ref text,
  food_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  grams numeric not null check (grams >= 0),
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists meal_entries_user_date_meal_idx on public.meal_entries (user_id, date, meal_type);

-- ---------------------------------------------------------------- favourite_meals
create table if not exists public.favourite_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  meal_type text check (meal_type in ('breakfast','lunch','snack','dinner')),
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists favourite_meals_user_idx on public.favourite_meals (user_id);

-- ---------------------------------------------------------------- daily_summaries
create table if not exists public.daily_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  kcal_in numeric not null default 0,
  protein_g numeric not null default 0,
  carbs_g numeric not null default 0,
  fat_g numeric not null default 0,
  kcal_active numeric not null default 0,
  active_minutes numeric not null default 0,
  workouts integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
