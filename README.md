# FitTrack

Personal health tracker PWA: exercise (manual now, Strava in Phase 2), weight, meals, BMI and a daily calorie allowance. Built with React, Vite, TypeScript, Tailwind, Supabase and Cloudflare Pages.

> BMI and calorie figures are estimates and not medical advice.

**Status:** Phase 1 (auth, profile, BMI and calorie target, weight log, meals, manual activities). See `docs/implementation-plan.html` for the full plan and `docs/prototype.html` for a clickable prototype.

## Prerequisites

- Node.js 20+ and npm
- A free [Supabase](https://supabase.com) account
- (Optional now) a free [Cloudflare](https://cloudflare.com) account for deployment
- (Optional) a Google Cloud OAuth client if you want Google sign-in

## 1. Install

```bash
npm install
```

## 2. Supabase setup

1. Create a new Supabase project. Note the **Project URL** and the **anon public key** (Project Settings, API).
2. Apply the migrations in `supabase/migrations` **in order** (0001 to 0005). Either:
   - paste each file into the Supabase SQL Editor and run it, or
   - use the CLI: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
3. Authentication, Providers: email is on by default. For Google sign-in, create an OAuth client in Google Cloud Console and add its client ID and secret under the Google provider. Add your site URL (local `http://localhost:5173` and your Cloudflare Pages URL) under Authentication, URL Configuration.
4. For quick local testing you may turn off "Confirm email" under the email provider. Turn it back on for real use.

More detail: `supabase/README.md`.

## 3. Configure environment

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Only these two reach the browser. The other variables in `.env.example` are server-side secrets for later phases and must never use the `VITE_` prefix.

## 4. Run

```bash
npm run dev
```

Open http://localhost:5173, sign up, complete onboarding.

## 5. Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # unit tests (shared calculations, time helpers, feature logic)
npm run build       # production build
```

Database tests (RLS, constraints, triggers, seeds) run against PGlite, no Docker needed:

```bash
cd supabase/tests && npm install && npm test
```

## 6. Deploy to Cloudflare Pages

1. Push this repo to GitHub.
2. Cloudflare dashboard, Workers and Pages, Create, Pages, connect the GitHub repo.
3. Build command `npm run build`, output directory `dist`, Node version 20 or newer.
4. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Add the resulting `*.pages.dev` URL to Supabase URL Configuration.

Every push to `main` then redeploys automatically.

## Project layout

```
src/                  React app (features/, components/, lib/)
packages/shared/      Pure TypeScript calculations (BMI, BMR, TDEE, targets, macros, MET) + tests
supabase/migrations/  Tables, RLS, seeds, triggers
supabase/tests/       PGlite database tests
docs/                 Plan, prototype, Phase 1 contract
```

## Roadmap

1. Auth, profile, BMI and calorie target, weight log, meals, manual activity (this phase)
2. Strava connect, sync, heart-rate zones, duplicate handling
3. Dashboard and reports
4. PWA polish, PDF/CSV export, weekly email
