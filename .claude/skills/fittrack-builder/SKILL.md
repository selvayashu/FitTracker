---
name: fittrack-builder
description: Build the FitTrack personal health tracker PWA (React + Vite + TypeScript + Tailwind, Supabase, Cloudflare Pages/Workers, Strava) phase by phase, acting as a senior full-stack engineer. Use when asked to build, extend, or continue FitTrack, or to work on its auth/profile, BMI/calorie calculations, meal logging, activity tracking, Strava sync, dashboard, reports, or PWA features.
---

# FitTrack Builder

Act as a senior full-stack engineer. You own the whole slice: schema, RLS, server logic, shared logic, UI, tests, and docs. Prefer boring, well-supported choices and keep everything on free tiers.

The full product spec is in [reference/spec.md](reference/spec.md). Read it before starting a phase. Do not re-derive requirements from memory.

## Stack (fixed)

- Frontend: React + Vite + TypeScript, Tailwind, Recharts, `vite-plugin-pwa`
- Hosting: Cloudflare Pages + Pages Functions/Workers (all Strava secrets live here)
- Backend: Supabase (Postgres, Auth, RLS, cron, Edge Functions only if needed)
- Source control: GitHub, auto-deploy to Cloudflare Pages

## Workflow

Build in four phases. **Stop at the end of each phase**, summarise what was built, give concrete test steps, and wait for the user's go-ahead before the next one.

1. **Phase 1**: auth, profile, BMI and calorie target, weight log, meal logging, manual activity entry
2. **Phase 2**: Strava connect, sync, HR zones, duplicate handling
3. **Phase 3**: dashboard and reports
4. **Phase 4**: PWA polish, PDF/CSV export, weekly email

Before each phase: check the repo state, list the files you will add or change, then build. After each phase: run type-check, lint and unit tests, and report real results (including failures).

## Repo layout

```
/src                 React app (features/, components/, lib/, hooks/)
/packages/shared     Pure TS calculations + Vitest tests (no framework imports)
/functions           Cloudflare Pages Functions / Worker (Strava)
/supabase/migrations Ordered SQL: tables, RLS, indexes, seeds
/public              PWA icons, manifest assets
.env.example         Every variable documented
README.md            Step-by-step setup
```

## Non-negotiable rules

- **Single source of truth for math**: BMI, BMR, TDEE, calorie target, macros, MET calories live only in `packages/shared`, with unit tests. UI and Workers import from it.
- **RLS on every table** with `user_id = auth.uid()`. Reference tables (`activity_types`, `foods`) are read-only to users. Test policies, don't assume them.
- **Secrets never reach the browser**: `STRAVA_CLIENT_SECRET`, `RESEND_API_KEY`, and the Supabase service-role key exist only as Worker/Function secrets. Only `SUPABASE_URL` and the anon key ship to the client.
- **Time**: store UTC, display `Asia/Kolkata`.
- **One `activities` table** with `source` (`strava` | `manual`) so dashboard and reports are source-agnostic. The app must be fully usable without Strava.
- **Mark estimates**: any calorie value from the MET formula sets `calories_estimated = true` and is labelled "estimated" in the UI and reports.
- **Validate at the edge**: duration 1-600 min, HR 40-220, positive weights/quantities. Validate in the form, and again in DB constraints.
- **Offline**: meal and activity entry queue locally and sync on reconnect; make sync idempotent (client-generated IDs).
- **Every screen** has loading, error and empty states; mobile-first; dark mode.
- Show a disclaimer that BMI and calorie figures are estimates, not medical advice.

## Core formulas (implement exactly, test boundaries)

- BMI = kg / m², rounded to 1 decimal. Asian cut-offs default: <18.5, 18.5-22.9, 23-24.9, >=25. WHO option: 25 / 30.
- BMR (Mifflin-St Jeor): `10w + 6.25h - 5a + 5` (male), `... - 161` (female).
- TDEE = BMR x {1.2, 1.375, 1.55, 1.725, 1.9}.
- Target = TDEE -/+ 275 (0.25 kg/wk) or 550 (0.5 kg/wk). Floor: max(BMR, 1200 female / 1500 male), and warn when the floor applies.
- Exercise add-back: default 50% of that day's exercise kcal.
- Macros: protein 1.2-1.6 g/kg, fat 25-30% of kcal, carbs = remainder (4/4/9 kcal per g).
- Activity kcal = MET x kg x hours. Weight change estimate: 7,700 kcal ~ 1 kg.
- Max HR default 220 - age (user-editable); zones 1-5 by % of max HR.

## Strava specifics

- OAuth scopes `read,activity:read_all`; code exchange happens in a Worker.
- Refresh tokens before `expires_at`; store tokens in an RLS-protected table.
- Initial sync = last 90 days; webhook for create/update; manual "Sync now".
- Queue requests and back off on HTTP 429.
- Duplicate flag: same type and start within +/-30 min of a manual entry; user keeps one.
- Disconnect = deauthorize + delete tokens; keep synced activities unless the user opts to delete.

## Definition of done (per phase)

- Migrations apply cleanly on a fresh Supabase project
- Shared-module tests pass; `tsc --noEmit` and lint are clean
- Happy path and one failure path manually verified (say what you actually ran)
- `.env.example` and README updated for anything new
- Phase summary with test checklist for the user, then stop
