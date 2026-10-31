-- 0002_rls.sql : row level security on every table

-- User-owned tables (profiles is keyed on user_id as well)
do $$
declare
  t text;
begin
  foreach t in array array['profiles','weight_logs','activities','activity_templates',
                           'custom_foods','meal_entries','favourite_meals']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))',
                   t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))',
                   t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
                   t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))',
                   t || '_delete_own', t);
  end loop;
end
$$;

-- Seeded reference tables: read-only for authenticated users
alter table public.activity_types enable row level security;
alter table public.activity_types force row level security;
drop policy if exists activity_types_select on public.activity_types;
create policy activity_types_select on public.activity_types for select to authenticated using (true);

alter table public.foods enable row level security;
alter table public.foods force row level security;
drop policy if exists foods_select on public.foods;
create policy foods_select on public.foods for select to authenticated using (true);

-- daily_summaries: select own only; writes come from SECURITY DEFINER triggers
alter table public.daily_summaries enable row level security;
alter table public.daily_summaries force row level security;
drop policy if exists daily_summaries_select_own on public.daily_summaries;
create policy daily_summaries_select_own on public.daily_summaries
  for select to authenticated using (user_id = (select auth.uid()));

-- Grants (Supabase grants broad defaults; be explicit so RLS is the only gate)
revoke all on public.activity_types, public.foods, public.daily_summaries from anon, authenticated;
grant select on public.activity_types, public.foods, public.daily_summaries to authenticated;
revoke all on public.profiles, public.weight_logs, public.activities, public.activity_templates,
  public.custom_foods, public.meal_entries, public.favourite_meals from anon;
grant select, insert, update, delete on public.profiles, public.weight_logs, public.activities,
  public.activity_templates, public.custom_foods, public.meal_entries, public.favourite_meals to authenticated;
