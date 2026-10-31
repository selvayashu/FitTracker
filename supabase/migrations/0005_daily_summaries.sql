-- 0005_daily_summaries.sql : keep daily_summaries in sync with meal_entries and activities

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

create or replace function public.trg_meal_entries_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.recompute_daily_summary(new.user_id, new.date);
  end if;
  if tg_op in ('DELETE','UPDATE') then
    if tg_op = 'DELETE' or old.user_id <> new.user_id or old.date <> new.date then
      perform public.recompute_daily_summary(old.user_id, old.date);
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.trg_activities_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.recompute_daily_summary(new.user_id, (new.start_time at time zone 'Asia/Kolkata')::date);
  end if;
  if tg_op in ('DELETE','UPDATE') then
    if tg_op = 'DELETE'
       or old.user_id <> new.user_id
       or (old.start_time at time zone 'Asia/Kolkata')::date <> (new.start_time at time zone 'Asia/Kolkata')::date then
      perform public.recompute_daily_summary(old.user_id, (old.start_time at time zone 'Asia/Kolkata')::date);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists meal_entries_summary on public.meal_entries;
create trigger meal_entries_summary after insert or update or delete on public.meal_entries
  for each row execute function public.trg_meal_entries_summary();

drop trigger if exists activities_summary on public.activities;
create trigger activities_summary after insert or update or delete on public.activities
  for each row execute function public.trg_activities_summary();
