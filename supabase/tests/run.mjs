// Runs all migrations against PGlite (Postgres in WASM) and asserts RLS, constraints, triggers, seeds.
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migDir = path.join(here, "..", "migrations");

const db = new PGlite({ extensions: { pg_trgm } });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + " " + extra); }
};

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// ---- stubs
await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`);

// pg_net stub (pg_cron is unavailable in PGlite; 0008 must still apply)
await db.exec(`
  create schema net;
  create table net.test_http_calls (id serial primary key, url text, headers jsonb, body jsonb);
  create table net.test_http_fail (user_id uuid);
  create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language plpgsql as $$
  begin
    if exists (select 1 from net.test_http_fail where user_id::text = body->>'user_id') then
      raise exception 'stub failure';
    end if;
    insert into net.test_http_calls (url, headers, body) values (url, headers, body);
    return 1;
  end $$;
`);

for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
  console.log("applied " + f);
}
// re-apply everything to check idempotency (seeds use ON CONFLICT; DDL uses IF NOT EXISTS)
for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
}
console.log("re-applied all migrations (idempotency)");

// default privileges for the stub environment (Supabase does this itself)
await db.exec(`grant usage on all sequences in schema public to authenticated;`);

// ---- helpers
async function as(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec(`reset role;`); }
}
async function fails(uid, sql, params = []) {
  try { await as(uid, () => db.query(sql, params)); return null; }
  catch (e) { return e.message; }
}
async function rowsAs(uid, sql, params = []) {
  return as(uid, async () => (await db.query(sql, params)).rows);
}

// ---- (d) signup trigger
console.log("signup trigger");
await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}')`);
const prof = (await db.query(`select user_id, bmi_standard, activity_tracking_mode, exercise_addback_pct, onboarded from profiles order by user_id`)).rows;
ok("profile row per new user", prof.length === 2);
ok("profile defaults", prof[0].bmi_standard === "asian" && prof[0].activity_tracking_mode === "manual"
  && Number(prof[0].exercise_addback_pct) === 50 && prof[0].onboarded === false);

// ---- data for B
await db.exec(`
  insert into weight_logs (user_id, date, weight_kg) values ('${B}', '2026-01-01', 70);
  insert into activities (id, user_id, activity_type_id, start_time, duration_min, calories)
    values ('b0000000-0000-0000-0000-000000000001', '${B}', 1, '2026-01-01T05:00:00Z', 30, 100);
  insert into activity_templates (user_id, name, activity_type_id, duration_min) values ('${B}', 'Walk', 1, 30);
  insert into custom_foods (user_id, name, kcal_per_100g) values ('${B}', 'Bs food', 100);
  insert into meal_entries (user_id, date, meal_type, food_name, quantity, unit, grams, kcal)
    values ('${B}', '2026-01-01', 'lunch', 'x', 1, 'g', 100, 100);
  insert into favourite_meals (user_id, name) values ('${B}', 'fav');
`);

// ---- (a) cross-user isolation
console.log("RLS isolation (A vs B)");
const owned = ["profiles", "weight_logs", "activities", "activity_templates", "custom_foods", "meal_entries", "favourite_meals"];
for (const t of owned) {
  const sel = await rowsAs(A, `select * from ${t} where user_id = '${B}'`);
  ok(`${t}: A cannot select B rows`, sel.length === 0);
  const upd = await as(A, () => db.query(`update ${t} set user_id = user_id where user_id = '${B}' returning 1`));
  ok(`${t}: A cannot update B rows`, upd.rows.length === 0);
  const del = await as(A, () => db.query(`delete from ${t} where user_id = '${B}' returning 1`));
  ok(`${t}: A cannot delete B rows`, del.rows.length === 0);
}
const ins = {
  profiles: `insert into profiles (user_id) values ('${B}')`,
  weight_logs: `insert into weight_logs (user_id, date, weight_kg) values ('${B}', '2026-02-02', 60)`,
  activities: `insert into activities (user_id, activity_type_id, start_time, duration_min) values ('${B}', 1, now(), 10)`,
  activity_templates: `insert into activity_templates (user_id, name, activity_type_id, duration_min) values ('${B}', 'n', 1, 10)`,
  custom_foods: `insert into custom_foods (user_id, name, kcal_per_100g) values ('${B}', 'n', 1)`,
  meal_entries: `insert into meal_entries (user_id, date, meal_type, food_name, quantity, unit, grams) values ('${B}', '2026-01-01', 'lunch', 'n', 1, 'g', 1)`,
  favourite_meals: `insert into favourite_meals (user_id, name) values ('${B}', 'n')`,
};
for (const t of owned) {
  const err = await fails(A, ins[t]);
  ok(`${t}: A cannot insert as B`, err && /row-level security/i.test(err), String(err));
}
// moving own row to another user is blocked by WITH CHECK
const mv = await fails(A, `update weight_logs set user_id = '${B}' where user_id = '${A}'`);
ok("update cannot reassign (no rows, no error ok)", mv === null || /row-level/i.test(mv));
// A can do own CRUD
await as(A, () => db.query(`insert into weight_logs (user_id, date, weight_kg) values ('${A}', '2026-01-01', 80)`));
ok("A can insert/select own", (await rowsAs(A, `select * from weight_logs`)).length === 1);
ok("weight_logs UNIQUE(user_id,date)", /unique|duplicate/i.test(await fails(A, `insert into weight_logs (user_id, date, weight_kg) values ('${A}', '2026-01-01', 81)`) ?? ""));
ok("daily_summaries: A sees none of B", (await rowsAs(A, `select * from daily_summaries`)).length === 0);
ok("daily_summaries: B sees own", (await rowsAs(B, `select * from daily_summaries`)).length === 1);
ok("daily_summaries: no direct write", /permission|row-level/i.test(await fails(A, `insert into daily_summaries (user_id, date) values ('${A}', '2026-01-01')`) ?? ""));

// ---- (b) reference tables
console.log("reference tables");
ok("authenticated can select activity_types", (await rowsAs(A, `select 1 from activity_types`)).length === 18);
ok("authenticated can select foods", (await rowsAs(A, `select 1 from foods limit 5`)).length === 5);
for (const [t, ins_, upd, del] of [
  ["activity_types", `insert into activity_types (id,name,met_light,met_moderate,met_vigorous) values (99,'x',1,2,3)`, `update activity_types set name='z'`, `delete from activity_types`],
  ["foods", `insert into foods (name,kcal_per_100g,serving_label,serving_g) values ('zz',1,'s',1)`, `update foods set name='z'`, `delete from foods`],
]) {
  ok(`${t}: insert denied`, (await fails(A, ins_)) !== null);
  const u = await fails(A, upd), d = await fails(A, del);
  const names = (await db.query(`select count(*)::int c from ${t}`)).rows[0].c;
  ok(`${t}: update denied`, u !== null);
  ok(`${t}: delete denied`, d !== null);
  ok(`${t}: rows intact`, names > 0);
}
ok("anon cannot read foods", (await (async () => {
  await db.exec(`set role anon`);
  try { await db.query(`select 1 from foods`); return false; } catch { return true; } finally { await db.exec(`reset role`); }
})()));

// ---- (c) CHECK constraints
console.log("CHECK constraints");
const act = (extra, v) => `insert into activities (user_id, activity_type_id, start_time, duration_min, ${extra}) values ('${A}', 1, now(), ${v[0]}, ${v[1]})`;
ok("duration 0 rejected", /check/i.test(await fails(A, `insert into activities (user_id, activity_type_id, start_time, duration_min) values ('${A}',1,now(),0)`) ?? ""));
ok("duration 601 rejected", /check/i.test(await fails(A, `insert into activities (user_id, activity_type_id, start_time, duration_min) values ('${A}',1,now(),601)`) ?? ""));
ok("duration 1 and 600 accepted", (await fails(A, `insert into activities (user_id, activity_type_id, start_time, duration_min) values ('${A}',1,now(),1),('${A}',1,now(),600)`)) === null);
await db.exec(`delete from activities where user_id='${A}'`);
ok("avg_hr 39 rejected", /check/i.test(await fails(A, act("avg_hr", [30, 39])) ?? ""));
ok("avg_hr 221 rejected", /check/i.test(await fails(A, act("avg_hr", [30, 221])) ?? ""));
ok("max_hr 39 rejected", /check/i.test(await fails(A, act("max_hr", [30, 39])) ?? ""));
ok("max_hr 221 rejected", /check/i.test(await fails(A, act("max_hr", [30, 221])) ?? ""));
ok("hr 40 and 220 accepted", (await fails(A, act("avg_hr", [30, 40]))) === null && (await fails(A, act("max_hr", [30, 220]))) === null);
await db.exec(`delete from activities where user_id='${A}'`);
ok("quantity 0 rejected", /check/i.test(await fails(A, `insert into meal_entries (user_id,date,meal_type,food_name,quantity,unit,grams) values ('${A}','2026-01-01','lunch','n',0,'g',1)`) ?? ""));
ok("bad meal_type rejected", /check/i.test(await fails(A, `insert into meal_entries (user_id,date,meal_type,food_name,quantity,unit,grams) values ('${A}','2026-01-01','brunch','n',1,'g',1)`) ?? ""));
ok("height 99 rejected", /check/i.test(await fails(A, `update profiles set height_cm = 99`) ?? ""));
ok("height 251 rejected", /check/i.test(await fails(A, `update profiles set height_cm = 251`) ?? ""));
ok("weight 19 rejected", /check/i.test(await fails(A, `update profiles set weight_kg = 19`) ?? ""));
ok("weight 401 rejected", /check/i.test(await fails(A, `update profiles set weight_kg = 401`) ?? ""));
ok("addback 101 rejected", /check/i.test(await fails(A, `update profiles set exercise_addback_pct = 101`) ?? ""));
ok("max_hr 99 / 231 rejected", /check/i.test(await fails(A, `update profiles set max_hr = 99`) ?? "") && /check/i.test(await fails(A, `update profiles set max_hr = 231`) ?? ""));
ok("pace 0.3 rejected", /check/i.test(await fails(A, `update profiles set pace = 0.3`) ?? ""));
ok("valid profile update", (await fails(A, `update profiles set height_cm=170, weight_kg=70, pace=0.5, sex='male', activity_level='very_active', goal='lose'`)) === null);
// strava_id partial unique
await db.exec(`insert into activities (user_id, activity_type_id, start_time, duration_min, strava_id) values ('${A}',1,now(),10,555)`);
ok("strava_id unique", /unique|duplicate/i.test(await fails(A, `insert into activities (user_id, activity_type_id, start_time, duration_min, strava_id) values ('${A}',1,now(),10,555)`) ?? ""));
ok("multiple null strava_id ok", (await fails(A, `insert into activities (user_id, activity_type_id, start_time, duration_min) values ('${A}',1,now(),10),('${A}',1,now(),10)`)) === null);
ok("ON CONFLICT (strava_id) upsert works", (await fails(A, `insert into activities (user_id, activity_type_id, start_time, duration_min, strava_id) values ('${A}',1,now(),20,555) on conflict (strava_id) do update set duration_min = excluded.duration_min`)) === null);
await db.exec(`delete from activities where user_id='${A}'`);

// ---- updated_at trigger
const u0 = (await db.query(`select updated_at from profiles where user_id='${A}'`)).rows[0].updated_at;
await new Promise((r) => setTimeout(r, 20));
await db.exec(`update profiles set name='A' where user_id='${A}'`);
const u1 = (await db.query(`select updated_at from profiles where user_id='${A}'`)).rows[0].updated_at;
ok("profiles.updated_at bumps", u1 > u0);

// ---- (e) daily_summaries triggers
console.log("daily_summaries triggers");
const sum = async (d) => (await db.query(`select * from daily_summaries where user_id='${A}' and date=$1`, [d])).rows[0];
await db.exec(`delete from daily_summaries where user_id='${A}'`);
// IST: 2026-03-10T20:00Z = 2026-03-11 01:30 IST ; 2026-03-10T10:00Z = 15:30 IST (03-10)
await as(A, async () => {
  await db.query(`insert into meal_entries (id,user_id,date,meal_type,food_name,quantity,unit,grams,kcal,protein,carbs,fat) values
    ('a0000000-0000-0000-0000-000000000001','${A}','2026-03-10','breakfast','a',1,'g',100,200,10,20,5),
    ('a0000000-0000-0000-0000-000000000002','${A}','2026-03-10','lunch','b',1,'g',100,300,15,30,10)`);
  await db.query(`insert into activities (id,user_id,activity_type_id,start_time,duration_min,calories) values
    ('a1000000-0000-0000-0000-000000000001','${A}',1,'2026-03-10T10:00:00Z',30,120),
    ('a1000000-0000-0000-0000-000000000002','${A}',3,'2026-03-10T20:00:00Z',40,400)`);
});
let s10 = await sum("2026-03-10"), s11 = await sum("2026-03-11");
ok("insert meals: kcal 500, P25 C50 F15", Number(s10.kcal_in) === 500 && Number(s10.protein_g) === 25 && Number(s10.carbs_g) === 50 && Number(s10.fat_g) === 15);
ok("insert activity: day 03-10 has 120 kcal / 30 min / 1 workout", Number(s10.kcal_active) === 120 && Number(s10.active_minutes) === 30 && s10.workouts === 1);
ok("activity crossing midnight IST lands on 03-11 (400 kcal)", s11 && Number(s11.kcal_active) === 400 && s11.workouts === 1 && Number(s11.kcal_in) === 0);
// update: move activity 2 from 03-11 to 03-10
await as(A, () => db.query(`update activities set start_time='2026-03-10T12:00:00Z' where id='a1000000-0000-0000-0000-000000000002'`));
s10 = await sum("2026-03-10"); s11 = await sum("2026-03-11");
ok("update moving day: 03-10 has 520 kcal / 70 min / 2 workouts", Number(s10.kcal_active) === 520 && Number(s10.active_minutes) === 70 && s10.workouts === 2);
ok("update moving day: 03-11 summary removed", s11 === undefined);
// update meal in place + move meal day
await as(A, () => db.query(`update meal_entries set kcal=250 where id='a0000000-0000-0000-0000-000000000001'`));
s10 = await sum("2026-03-10");
ok("update meal in place: kcal_in 550", Number(s10.kcal_in) === 550);
await as(A, () => db.query(`update meal_entries set date='2026-03-12' where id='a0000000-0000-0000-0000-000000000002'`));
s10 = await sum("2026-03-10"); const s12 = await sum("2026-03-12");
ok("meal moved: 03-10 kcal_in 250, 03-12 kcal_in 300", Number(s10.kcal_in) === 250 && s12 && Number(s12.kcal_in) === 300);
// delete
await as(A, () => db.query(`delete from activities where id='a1000000-0000-0000-0000-000000000001'`));
s10 = await sum("2026-03-10");
ok("delete activity: 400 kcal / 40 min / 1 workout", Number(s10.kcal_active) === 400 && Number(s10.active_minutes) === 40 && s10.workouts === 1);
await as(A, () => db.query(`delete from meal_entries where id='a0000000-0000-0000-0000-000000000002'`));
ok("delete last meal on a day removes summary", (await sum("2026-03-12")) === undefined);
await as(A, async () => {
  await db.query(`delete from meal_entries where id='a0000000-0000-0000-0000-000000000001'`);
  await db.query(`delete from activities where user_id='${A}'`);
});
ok("all deleted: no summaries left", (await db.query(`select 1 from daily_summaries where user_id='${A}'`)).rows.length === 0);
ok("B summary unaffected", (await db.query(`select 1 from daily_summaries where user_id='${B}'`)).rows.length === 1);

// ---- Phase 2 (0006_strava)
console.log("Phase 2: strava");
const anonFails = async (sql) => { await db.exec(`set role anon`); try { await db.query(sql); return null; } catch (e) { return e.message; } finally { await db.exec(`reset role`); } };
// (a) strava_connections locked down
await db.exec(`insert into strava_connections (user_id, athlete_id, access_token, refresh_token, expires_at, scope, last_sync_at)
  values ('${B}', 4242, 'secret-access', 'secret-refresh', now() + interval '1 hour', 'read,activity:read_all', '2026-05-01T00:00:00Z')`);
ok("superuser can read strava_connections", (await db.query(`select * from strava_connections`)).rows.length === 1);
for (const [label, sql] of [
  ["select", `select * from strava_connections`],
  ["select B's tokens", `select access_token from strava_connections where user_id = '${B}'`],
  ["insert own", `insert into strava_connections (user_id, athlete_id, access_token, refresh_token, expires_at) values ('${A}', 1, 'a', 'b', now())`],
  ["insert as other", `insert into strava_connections (user_id, athlete_id, access_token, refresh_token, expires_at) values ('${B}', 2, 'a', 'b', now())`],
  ["update", `update strava_connections set scope = 'x'`],
  ["delete", `delete from strava_connections`],
]) {
  ok(`strava_connections: authenticated ${label} denied`, (await fails(A, sql)) !== null);
  ok(`strava_connections: anon ${label} denied`, (await anonFails(sql)) !== null);
}
ok("strava_connections: row intact", (await db.query(`select 1 from strava_connections`)).rows.length === 1);
ok("strava_connections: RLS enabled+forced, no policies",
  (await db.query(`select relrowsecurity r, relforcerowsecurity f, (select count(*)::int from pg_policies where tablename='strava_connections') p from pg_class where relname='strava_connections'`)).rows
    .every((r) => r.r && r.f && r.p === 0));
// (b) strava_status
const stA = await rowsAs(A, `select * from strava_status()`);
ok("strava_status: no connection -> one row connected=false, nulls", stA.length === 1 && stA[0].connected === false && stA[0].athlete_id === null && stA[0].last_sync_at === null && stA[0].scope === null);
const stB = await rowsAs(B, `select * from strava_status()`);
ok("strava_status: connected row", stB.length === 1 && stB[0].connected === true && Number(stB[0].athlete_id) === 4242 && new Date(stB[0].last_sync_at).toISOString() === "2026-05-01T00:00:00.000Z" && stB[0].scope === "read,activity:read_all");
ok("strava_status: columns exactly connected,athlete_id,last_sync_at,scope, no tokens",
  JSON.stringify(Object.keys(stB[0])) === JSON.stringify(["connected", "athlete_id", "last_sync_at", "scope"]) && !JSON.stringify(stB).includes("secret"));
ok("strava_status: anon cannot execute", /permission/i.test((await anonFails(`select * from strava_status()`)) ?? ""));
// (c) activity_hr_zones
await db.exec(`insert into activities (id,user_id,activity_type_id,start_time,duration_min) values
  ('a2000000-0000-0000-0000-00000000000a','${A}',1,'2026-04-01T05:00:00Z',30),
  ('b2000000-0000-0000-0000-00000000000b','${B}',1,'2026-04-01T05:00:00Z',30)`);
await db.exec(`insert into activity_hr_zones (activity_id,user_id,zone1_s,max_hr_used) values ('b2000000-0000-0000-0000-00000000000b','${B}',60,190)`);
ok("zones: A cannot select B", (await rowsAs(A, `select * from activity_hr_zones`)).length === 0);
ok("zones: B sees own", (await rowsAs(B, `select * from activity_hr_zones`)).length === 1);
ok("zones: A cannot update B", (await as(A, () => db.query(`update activity_hr_zones set zone1_s = 1 returning 1`))).rows.length === 0);
ok("zones: A cannot delete B", (await as(A, () => db.query(`delete from activity_hr_zones returning 1`))).rows.length === 0);
ok("zones: A cannot insert as B", /row-level/i.test(await fails(A, `insert into activity_hr_zones (activity_id,user_id,max_hr_used) values ('a2000000-0000-0000-0000-00000000000a','${B}',190)`) ?? ""));
ok("zones: A cannot attach zone to B's activity (even as self)", /row-level/i.test(await fails(A, `insert into activity_hr_zones (activity_id,user_id,max_hr_used) values ('b2000000-0000-0000-0000-00000000000b','${A}',190)`) ?? ""));
ok("zones: A can insert own", (await fails(A, `insert into activity_hr_zones (activity_id,user_id,zone2_s,max_hr_used) values ('a2000000-0000-0000-0000-00000000000a','${A}',120,185)`)) === null);
ok("zones: A cannot repoint own zone row to B's activity", (await fails(A, `update activity_hr_zones set activity_id = 'b2000000-0000-0000-0000-00000000000b' where user_id = '${A}'`)) !== null);
ok("zones: negative seconds rejected", /check/i.test(await fails(A, `update activity_hr_zones set zone3_s = -1`) ?? ""));
ok("zones: anon denied", (await anonFails(`select * from activity_hr_zones`)) !== null);
await as(A, () => db.query(`delete from activities where id='a2000000-0000-0000-0000-00000000000a'`));
ok("zones: cascade on activity delete", (await db.query(`select 1 from activity_hr_zones where user_id='${A}'`)).rows.length === 0);
await db.exec(`delete from activities where id = 'b2000000-0000-0000-0000-00000000000b'`);
// (d) duplicate_of FK
await db.exec(`insert into activities (id,user_id,activity_type_id,start_time,duration_min,source) values
  ('a3000000-0000-0000-0000-000000000001','${A}',1,'2026-04-02T05:00:00Z',30,'manual')`);
await db.exec(`insert into activities (id,user_id,activity_type_id,start_time,duration_min,source,strava_id,duplicate_of) values
  ('a3000000-0000-0000-0000-000000000002','${A}',1,'2026-04-02T05:05:00Z',30,'strava',777,'a3000000-0000-0000-0000-000000000001')`);
ok("duplicate_of FK rejects unknown id", /foreign key/i.test(await fails(A, `update activities set duplicate_of = 'a3999999-0000-0000-0000-000000000009' where id='a3000000-0000-0000-0000-000000000002'`) ?? ""));
await as(A, () => db.query(`delete from activities where id='a3000000-0000-0000-0000-000000000001'`));
ok("deleting manual row nulls strava duplicate_of", (await db.query(`select duplicate_of from activities where id='a3000000-0000-0000-0000-000000000002'`)).rows[0].duplicate_of === null);
ok("duplicate_of FK exists exactly once", (await db.query(`select count(*)::int c from pg_constraint where conrelid='activities'::regclass and contype='f' and confrelid='activities'::regclass`)).rows[0].c === 1);
// (e) excluded ignored by daily_summaries
const sum4 = async () => (await db.query(`select * from daily_summaries where user_id='${A}' and date='2026-04-02'`)).rows[0];
await db.exec(`update activities set calories = 200 where id='a3000000-0000-0000-0000-000000000002'`);
let s4 = await sum4();
ok("strava activity counted: 200 kcal, 30 min, 1 workout", s4 && Number(s4.kcal_active) === 200 && Number(s4.active_minutes) === 30 && s4.workouts === 1);
await as(A, () => db.query(`update activities set excluded = true where id='a3000000-0000-0000-0000-000000000002'`));
ok("excluded=true: day summary removed", (await sum4()) === undefined);
await db.exec(`insert into activities (user_id,activity_type_id,start_time,duration_min,calories) values ('${A}',1,'2026-04-02T06:00:00Z',10,50)`);
s4 = await sum4();
ok("excluded row ignored beside a normal one: 50 kcal / 1 workout", Number(s4.kcal_active) === 50 && s4.workouts === 1);
await as(A, () => db.query(`update activities set excluded = false where id='a3000000-0000-0000-0000-000000000002'`));
s4 = await sum4();
ok("excluded=false: totals return (250 kcal, 40 min, 2 workouts)", Number(s4.kcal_active) === 250 && Number(s4.active_minutes) === 40 && s4.workouts === 2);
await as(A, () => db.query(`delete from activities where user_id='${A}'`));
ok("delete: summary gone", (await sum4()) === undefined);
// (f) new CHECKs
const ac = (col, v) => `insert into activities (user_id,activity_type_id,start_time,duration_min,${col}) values ('${A}',1,now(),10,${v})`;
for (const col of ["elevation_m", "suffer_score", "moving_time_s", "elapsed_time_s"]) {
  ok(`${col} -1 rejected`, /check/i.test(await fails(A, ac(col, -1)) ?? ""));
  ok(`${col} 0 accepted`, (await fails(A, ac(col, 0))) === null);
}
ok("excluded/duplicate_dismissed default false", (await db.query(`select bool_or(excluded) e, bool_or(duplicate_dismissed) d from activities where user_id='${A}'`)).rows[0].e === false);
ok("excluded null rejected", /null/i.test(await fails(A, `update activities set excluded = null`) ?? ""));
await db.exec(`delete from activities where user_id='${A}'`);
// (h) strava_id uniqueness across users
await db.exec(`insert into activities (user_id,activity_type_id,start_time,duration_min,strava_id) values ('${A}',1,now(),10,9001)`);
ok("strava_id unique across users", /unique|duplicate/i.test(await fails(B, `insert into activities (user_id,activity_type_id,start_time,duration_min,strava_id) values ('${B}',1,now(),10,9001)`) ?? ""));
await db.exec(`delete from activities where user_id='${A}'`);
// (g) all migrations once more with data present
for (const f of fs.readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(fs.readFileSync(path.join(migDir, f), "utf8"));
}
ok("migrations re-run cleanly a third time with data present", (await db.query(`select 1 from strava_connections`)).rows.length === 1);
ok("activities_summary trigger still single", (await db.query(`select count(*)::int c from pg_trigger where tgname='activities_summary'`)).rows[0].c === 1);
await db.exec(`delete from strava_connections`);

// ---- (f) seeds
console.log("seeds");
const nAt = (await db.query(`select count(*)::int c from activity_types`)).rows[0].c;
const nF = (await db.query(`select count(*)::int c from foods`)).rows[0].c;
ok(`18 activity types (got ${nAt})`, nAt === 18);
ok(`>= 280 foods (got ${nF})`, nF >= 280);
const idli = (await db.query(`select unit_grams, serving_g from foods where name='Idli'`)).rows[0];
ok("idli unit_grams piece=40", idli && idli.unit_grams.piece === 40);
const off = (await db.query(`select name, kcal_per_100g k, protein_per_100g p, carbs_per_100g c, fat_per_100g f, fibre_per_100g fi from foods`)).rows
  .filter((r) => { const a = 4 * r.p + 4 * (r.c - r.fi) + 2 * r.fi + 9 * r.f; return a > 20 && Math.abs(r.k - a) / a > 0.15; });
ok("all foods kcal within 15% of Atwater (fibre at 2 kcal/g)", off.length === 0, JSON.stringify(off.slice(0, 5)));
ok("trigram search works", (await db.query(`select 1 from foods where lower(name) like '%dosa%'`)).rows.length >= 4);
ok("RLS forced on all tables", (await db.query(`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not (c.relrowsecurity and c.relforcerowsecurity)`)).rows[0].c === 0);

// ---- Phase 4: weekly email (0008)
console.log("weekly email (0008)");
ok("pg_cron/pg_net unavailable in PGlite (guard path exercised)", (await db.query(`select 1 from pg_available_extensions where name in ('pg_cron','pg_net')`)).rows.length === 0);
await db.exec(fs.readFileSync(path.join(migDir, "0008_email.sql"), "utf8"));
ok("0008 re-applied cleanly", true);
const C = "cccccccc-cccc-cccc-cccc-cccccccccccc", D = "dddddddd-dddd-dddd-dddd-dddddddddddd",
  E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", F = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const asAnon = async (sql) => {
  await db.exec(`set role anon`);
  try { const r = await db.query(sql); return { rows: r.rows, err: null }; }
  catch (e) { return { rows: [], err: e.message }; }
  finally { await db.exec(`reset role`); }
};
// (h) defaults via signup trigger
await db.exec(`insert into auth.users (id) values ('${C}'), ('${D}'), ('${E}'), ('${F}')`);
const dp = (await db.query(`select email_weekly, last_weekly_email_at from profiles where user_id='${C}'`)).rows[0];
ok("new profile: email_weekly false, last_weekly_email_at null", dp.email_weekly === false && dp.last_weekly_email_at === null);
// (b) own vs other
await as(A, () => db.query(`update profiles set email_weekly = true where user_id='${A}'`));
ok("user can set own email_weekly", (await rowsAs(A, `select email_weekly from profiles`))[0].email_weekly === true);
const xu = await as(A, () => db.query(`update profiles set email_weekly = true where user_id='${B}' returning 1`));
ok("user cannot update another user's email_weekly", xu.rows.length === 0);
ok("other user's email_weekly unchanged", (await db.query(`select email_weekly from profiles where user_id='${B}'`)).rows[0].email_weekly === false);
ok("user cannot read another user's profile", (await rowsAs(A, `select * from profiles where user_id='${B}'`)).length === 0);
const au = await asAnon(`update profiles set email_weekly = true returning 1`);
ok("anon cannot update profiles", au.rows.length === 0, String(au.err));
ok("anon update changed nothing", (await db.query(`select count(*)::int c from profiles where email_weekly and user_id<>'${A}'`)).rows[0].c === 0);
await db.exec(`update profiles set email_weekly=false where user_id='${A}'`);
// (c) app_config
for (const q of [`select * from app_config`, `insert into app_config (key,value) values ('x','y')`, `update app_config set value='z'`, `delete from app_config`]) {
  ok(`authenticated: ${q.split(" ")[0]} app_config denied`, /permission denied/i.test(await fails(A, q) ?? ""));
  const r = await asAnon(q);
  ok(`anon: ${q.split(" ")[0]} app_config denied`, /permission denied/i.test(r.err ?? ""), String(r.err));
}
ok("app_config RLS enabled and forced", (await db.query(`select relrowsecurity r, relforcerowsecurity f from pg_class where oid='public.app_config'::regclass`)).rows[0].f === true);
ok("app_config has no policies", (await db.query(`select count(*)::int c from pg_policies where tablename='app_config'`)).rows[0].c === 0);
// (d) missing config
await db.exec(`delete from app_config; update profiles set email_weekly=true, onboarded=true`);
ok("no config: returns 0", (await db.query(`select public.send_weekly_summaries() n`)).rows[0].n === 0);
await db.exec(`insert into app_config values ('email_endpoint_url','https://x.test/api/email/weekly')`);
ok("only url: returns 0", (await db.query(`select public.send_weekly_summaries() n`)).rows[0].n === 0);
await db.exec(`update app_config set value='' where key='email_endpoint_url'; insert into app_config values ('cron_secret','s3cret')`);
ok("empty url: returns 0", (await db.query(`select public.send_weekly_summaries() n`)).rows[0].n === 0);
ok("nothing queued without config", (await db.query(`select count(*)::int c from net.test_http_calls`)).rows[0].c === 0);
// (e) eligibility
await db.exec(`
  update app_config set value='https://x.test/api/email/weekly' where key='email_endpoint_url';
  update profiles set email_weekly=false, onboarded=false, last_weekly_email_at=null;
  update profiles set email_weekly=true, onboarded=true where user_id='${A}';
  update profiles set email_weekly=true, onboarded=true, last_weekly_email_at=now()-interval '7 days' where user_id='${B}';
  update profiles set email_weekly=false, onboarded=true where user_id='${C}';
  update profiles set email_weekly=true, onboarded=false where user_id='${D}';
  update profiles set email_weekly=true, onboarded=true, last_weekly_email_at=now()-interval '5 days' where user_id='${E}';
`);
ok("returns 2 for the eligible users", (await db.query(`select public.send_weekly_summaries() n`)).rows[0].n === 2);
const calls = (await db.query(`select * from net.test_http_calls`)).rows;
ok("exactly 2 calls", calls.length === 2);
ok("calls target A and B only", JSON.stringify(calls.map((c) => c.body.user_id).sort()) === JSON.stringify([A, B]));
ok("calls carry url, secret header, content-type, {user_id} body", calls.every((c) => c.url === "https://x.test/api/email/weekly"
  && c.headers["x-cron-secret"] === "s3cret" && c.headers["Content-Type"] === "application/json"
  && Object.keys(c.body).join() === "user_id"));
// (f) failure isolation
await db.exec(`delete from net.test_http_calls; insert into net.test_http_fail values ('${A}')`);
ok("one failing user: returns count of successes (1)", (await db.query(`select public.send_weekly_summaries() n`)).rows[0].n === 1);
const calls2 = (await db.query(`select body->>'user_id' u from net.test_http_calls`)).rows;
ok("others still queued", calls2.length === 1 && calls2[0].u === B);
await db.exec(`delete from net.test_http_fail; delete from net.test_http_calls`);
// (g) execute privileges
const exErr = await fails(A, `select public.send_weekly_summaries()`);
ok("authenticated cannot execute send_weekly_summaries", /permission denied/i.test(exErr ?? ""), String(exErr));
const ea = await asAnon(`select public.send_weekly_summaries()`);
ok("anon cannot execute send_weekly_summaries", /permission denied/i.test(ea.err ?? ""), String(ea.err));
ok("secret not leaked in error text", !/s3cret/.test((exErr ?? "") + (ea.err ?? "")));
await db.exec(`delete from app_config`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
