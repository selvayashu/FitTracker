# FitTrack

Personal health tracker PWA: exercise (manual now, Strava in Phase 2), weight, meals, BMI and a daily calorie allowance. Built with React, Vite, TypeScript, Tailwind, Supabase and Cloudflare Pages.

> BMI and calorie figures are estimates and not medical advice.

**Status:** Phase 1 built (auth, profile, BMI and calorie target, weight log, meals, manual activities); Phase 2 (Strava), Phase 3 (dashboard and reports) and Phase 4 (PWA, export, weekly email) built, awaiting testing. See `docs/implementation-plan.html` for the full plan and `docs/prototype.html` for a clickable prototype.

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
2. Apply the migrations in `supabase/migrations` **in order** (0001 to 0005, plus 0006 and 0007 for Strava). Either:
   - paste each file into the Supabase SQL Editor and run it, or
   - use the CLI: `npx supabase login`, `npx supabase link --project-ref <ref>`, `npx supabase db push`.
3. Authentication, Providers: email is on by default. For Google sign-in, create an OAuth client in Google Cloud Console and add its client ID and secret under the Google provider. Add your site URL (local `http://localhost:5173` and your Cloudflare Pages URL, each also with `/reset-password` as an allowed redirect for the password-reset email) under Authentication, URL Configuration.
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

## 7. Strava (Phase 2, optional)

FitTrack works fully without Strava. To enable syncing:

**a. Create the Strava API app** at https://www.strava.com/settings/api
- Application name and website: anything (your Pages URL is fine).
- **Authorization Callback Domain:** your domain only, no `https://` and no path, for example `fittrack.pages.dev` (use `localhost` for local testing).
- Copy the **Client ID** and **Client Secret**. A new Strava app is limited to one athlete (you) until Strava approves it, which is fine for personal use. Default limits are 100 requests per 15 minutes and 1,000 per day; the sync backs off automatically.

**b. Apply the Strava migrations.** `supabase/migrations/0006_strava.sql` and `0007_strava_id_unique.sql` (run after 0001-0005). Tokens are stored in a table that browsers cannot read.

**c. Set the secrets in Cloudflare** (Pages project, Settings, Variables and Secrets, add as *Secret* for Production and Preview):

| Name | Value |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_ANON_KEY` | the anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project Settings, API, `service_role` key. **Cloudflare secret only. Never put it in `.env.local`, the repo or the browser.** |
| `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` | from step a |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string you invent |
| `STRAVA_STATE_SECRET` | a random string of 32+ characters |

Redeploy after saving the secrets.

**d. Register the webhook (once, after the first deploy).** Strava calls your webhook URL to verify it, so the deployed site must be live:

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions   -F client_id=YOUR_CLIENT_ID -F client_secret=YOUR_CLIENT_SECRET   -F callback_url=https://YOUR-SITE.pages.dev/api/strava/webhook   -F verify_token=YOUR_STRAVA_WEBHOOK_VERIFY_TOKEN
```

A response like `{"id": 123456}` means it worked. Add that number as the Cloudflare secret `STRAVA_SUBSCRIPTION_ID` (and redeploy) so the webhook ignores events that do not come from your subscription. Only one subscription is allowed per app. To inspect or remove it: `GET` the same URL with `client_id` and `client_secret` query parameters, or `DELETE https://www.strava.com/api/v3/push_subscriptions/<id>` with the same two fields.

**e. Local testing of the Worker code** (optional): copy `.dev.vars.example` to `.dev.vars`, fill it in, then `npm run build && npx wrangler pages dev dist`. The Strava callback domain must then be `localhost`.

## 8. Weekly summary email (Phase 4, optional)

Each user opts in under **Settings, Weekly summary email**. Every Monday about 08:00 IST, Supabase's scheduler asks the site to email each opted-in user a summary of their previous 7 days.

**a. Resend.** Create a free account at https://resend.com and an API key. The sandbox sender `onboarding@resend.dev` only delivers to your own Resend account email, which is enough to test. To email other people, verify a domain in Resend and set `EMAIL_FROM` to an address on it.

**b. Cloudflare secrets** (same place as the Strava ones; redeploy afterwards):

| Name | Value |
|---|---|
| `RESEND_API_KEY` | your Resend API key |
| `EMAIL_FROM` | optional, for example `FitTrack <summary@yourdomain.com>` |
| `CRON_SECRET` | a random 32+ character string (also stored in the database, next step) |
| `EMAIL_TOKEN_SECRET` | another random 32+ character string (signs unsubscribe links) |

**c. Supabase.** Apply `supabase/migrations/0008_email.sql`. Then in the dashboard enable the extensions **pg_cron** and **pg_net** (Database, Extensions) and re-run the schedule part of the migration, or follow `supabase/README.md`. Store the endpoint and the same cron secret:

```sql
insert into app_config (key, value) values
  ('email_endpoint_url', 'https://YOUR-SITE.pages.dev/api/email/weekly'),
  ('cron_secret', 'THE-SAME-VALUE-AS-CLOUDFLARE-CRON_SECRET')
on conflict (key) do update set value = excluded.value;
```

**d. Try it now** without waiting for Monday (turn the switch on in Settings first, and log some meals in the last 7 days):

```bash
curl -X POST https://YOUR-SITE.pages.dev/api/email/weekly   -H "Content-Type: application/json" -H "x-cron-secret: YOUR_CRON_SECRET"   -d '{"user_id":"YOUR-USER-UUID","force":true}'
```

`{"sent":true}` means it was sent. `{"sent":false,"reason":"no_data"}` means nothing was logged in the previous 7 days. Every email has a one-click unsubscribe link.

## 9. Install as an app and offline use

FitTrack is an installable PWA. On Android or desktop Chrome and Edge use **Settings, Install app**; on iPhone use Safari, Share, **Add to Home Screen**. Once loaded, the app opens offline, and meals and activities you add offline are saved on the device and sent when you are back online. When a new version is deployed, a "new version is ready" bar offers **Reload**; nothing reloads by itself.

Only the app files and the food and activity-type lists are cached for offline use. Your personal data, sign-in and `/api` calls are never stored by the service worker.

**Security headers.** `public/_headers` sets standard protective headers and a Content-Security-Policy in **report-only** mode. After you have used every screen (including Strava, reports and PDF export) with the browser console open and seen no "Content Security Policy" violations, rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in that file to enforce it.

**Export.** Reports has an **Export** menu: Daily CSV, Entries CSV and PDF, for the range on screen.

## Project layout

```
src/                  React app (features/, components/, lib/)
packages/shared/      Pure TypeScript calculations (BMI, BMR, TDEE, targets, macros, MET) + tests
supabase/migrations/  Tables, RLS, seeds, triggers
supabase/tests/       PGlite database tests
docs/                 Plan, prototype, Phase 1 contract
```

## Roadmap

1. Auth, profile, BMI and calorie target, weight log, meals, manual activity (done, awaiting your testing)
2. Strava connect, sync, heart-rate zones, duplicate handling (done, awaiting your testing)
3. Dashboard and reports (done, awaiting your testing)
4. PWA polish, PDF/CSV export, weekly email (in progress)
