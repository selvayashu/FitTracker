-- 0008_email.sql : weekly summary email (Phase 4). Re-runnable.

-- 1. profile columns -----------------------------------------------------------
alter table public.profiles
  add column if not exists email_weekly boolean not null default false,
  add column if not exists last_weekly_email_at timestamptz;
-- Existing profiles RLS (own-row select/update) already covers these columns.

-- 2. app_config: server-side settings, reachable ONLY with service-role/postgres --
create table if not exists public.app_config (
  key text primary key,
  value text not null
);
comment on table public.app_config is
  'Server-side settings (email_endpoint_url, cron_secret). RLS enabled and forced with NO policies and no grants for anon/authenticated: only the service-role/postgres role can read or write.';
alter table public.app_config enable row level security;
alter table public.app_config force row level security;
revoke all on public.app_config from anon, authenticated;

-- 3. send_weekly_summaries ---------------------------------------------------------
create or replace function public.send_weekly_summaries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_count integer := 0;
  r record;
begin
  select value into v_url from public.app_config where key = 'email_endpoint_url';
  select value into v_secret from public.app_config where key = 'cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    raise notice 'send_weekly_summaries: email_endpoint_url or cron_secret missing in app_config; nothing queued';
    return 0;
  end if;

  for r in
    select p.user_id
      from public.profiles p
     where p.email_weekly
       and p.onboarded
       and (p.last_weekly_email_at is null or p.last_weekly_email_at < now() - interval '6 days')
  loop
    begin
      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := jsonb_build_object('user_id', r.user_id)
      );
      v_count := v_count + 1;
    exception when others then
      raise warning 'send_weekly_summaries: request failed for user %', r.user_id;
    end;
  end loop;
  return v_count;
end
$$;
revoke all on function public.send_weekly_summaries() from public, anon, authenticated;

-- 4. guarded extensions + cron schedule ---------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  else
    raise notice 'pg_net is not available: enable it in Dashboard -> Database -> Extensions';
  end if;
exception when others then
  raise notice 'could not enable pg_net (%): enable it in Dashboard -> Database -> Extensions', sqlerrm;
end
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    if exists (select 1 from cron.job where jobname = 'fittrack-weekly-summary') then
      perform cron.unschedule('fittrack-weekly-summary');
    end if;
    perform cron.schedule('fittrack-weekly-summary', '30 2 * * 1', $job$select public.send_weekly_summaries()$job$);
  else
    raise notice 'pg_cron is not available: enable it in Dashboard -> Database -> Extensions, then re-run this migration';
  end if;
exception when others then
  raise notice 'could not schedule weekly summary job (%): enable pg_cron in Dashboard -> Database -> Extensions, then re-run this migration', sqlerrm;
end
$$;
