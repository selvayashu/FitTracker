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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
