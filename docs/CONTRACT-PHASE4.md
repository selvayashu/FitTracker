# Phase 4 Contract (PWA polish, export, weekly email)

FROZEN: this file, `packages/shared/src/exportTypes.ts`, `functions/env.d.ts`, `src/lib/database.types.ts`, `src/lib/pwa.ts`. Report problems instead of editing them. Earlier contracts and the skill's non-negotiable rules still apply.

## Ownership

| Owner | Paths |
|---|---|
| Shared agent | `packages/shared/src/exports.ts`, `packages/shared/src/exports.test.ts`, and the one-line `export * from "./exports";` in `packages/shared/src/index.ts` |
| DB agent | `supabase/migrations/0008_email.sql`, `supabase/tests/**`, `supabase/README.md` |
| Worker agent | `functions/api/email/**`, `functions/_lib/email/**` (new), `.dev.vars.example` (append only) |
| Frontend agent | `src/features/**` |
| Orchestrator | PWA (`vite.config.ts`, `public/**`, `index.html`, `src/main.tsx`, `src/components/**`, `src/lib/**`), README, docs, config |

## Weekly email: architecture

1. `profiles.email_weekly boolean not null default false` (opt-in, toggled by the user in Settings) and `profiles.last_weekly_email_at timestamptz`.
2. Supabase `pg_cron` runs `public.send_weekly_summaries()` every Monday 02:30 UTC (08:00 IST). It does **not** send mail: for each opted-in, onboarded user who has not been mailed in the last 6 days it calls `net.http_post` (pg_net) once per user to `<email_endpoint_url>` with headers `Content-Type: application/json` and `x-cron-secret: <cron_secret>` and body `{ "user_id": "<uuid>" }`. One request per user keeps each Cloudflare invocation inside the free-plan subrequest limit.
3. `email_endpoint_url` and `cron_secret` live in table `public.app_config (key text primary key, value text not null)`, with RLS enabled and forced and **no policies**, all privileges revoked from `anon` and `authenticated`. If either row is missing the function does nothing (raises a notice, returns 0).
4. The Worker endpoint `POST /api/email/weekly` verifies `x-cron-secret` (constant-time) against `env.CRON_SECRET`, loads that user with the service-role client, applies the same guards again (opted in, not mailed in 6 days), reads the user's email via the Supabase Auth admin API, builds the summary for the 7 IST days **ending yesterday** with the same shared functions as the Reports screen (`summarizeRange`, `buildInsights`), renders it with `buildWeeklyEmail`, and sends it through Resend (`POST https://api.resend.com/emails`, Bearer `RESEND_API_KEY`, `from` = `env.EMAIL_FROM` or `FitTrack <onboarding@resend.dev>`, headers `List-Unsubscribe: <unsubscribeUrl>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`). On success it sets `last_weekly_email_at = now()`. Response `{ sent: boolean, reason?: string }` with reasons `not_opted_in`, `recently_sent`, `no_data` (a week with zero logged days sends nothing), `no_email`, `send_failed`. Subrequest budget per call: about 8.
5. Unsubscribe: link `https://<origin>/api/email/unsubscribe?token=<uid>.<hmac>` where the token is `base64url(HMAC-SHA256(EMAIL_TOKEN_SECRET, "unsubscribe:" + uid))` appended to the user id; no expiry. `GET` shows a small HTML confirmation page with a button that `POST`s; `POST` (also what mail clients send for one-click) sets `email_weekly = false` and returns 200 with a confirmation page. Invalid token: 400 page, no state change. Prefetching a GET must never unsubscribe.
6. Secrets: `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `EMAIL_TOKEN_SECRET` only as Cloudflare secrets. Never log the recipient address, the token or any secret. All user-provided text in HTML is escaped.

## Shared API (`packages/shared/src/exports.ts`, pure)

```ts
csvEscape(value: string | number | boolean | null | undefined): string   // RFC 4180 quoting; TEXT cells starting with = + - @ tab or CR get a leading ' (formula-injection guard); numbers (including negatives) are written as-is; null/undefined -> empty
formatRangeLabel(range: DateRange): string                               // "5 Mar - 11 Mar 2026", "5 Mar 2026" for one day, years shown when they differ
formatIstDateTime(date: Date): string                                    // "31 Oct 2026, 14:05 IST" (UTC+05:30 arithmetic, no Intl dependence)
exportFileName(kind: "daily" | "entries" | "pdf", range: DateRange): string   // fittrack-daily-2026-03-05_to_2026-03-11.csv, ...-entries-..., fittrack-report-....pdf (one-day ranges still use from_to)
buildDailyCsv(summary: RangeSummary, meta: ExportMeta): CsvFile          // one row per day: date, logged, kcal_in, protein_g, carbs_g, fat_g, breakfast_kcal, lunch_kcal, snack_kcal, dinner_kcal, active_kcal, active_kcal_estimated, active_min, workouts, bmr_estimated, kcal_out_estimated, net_estimated, allowance, remaining, on_target; BOM + CRLF; header row; unlogged days have empty intake/net cells
buildEntriesCsv(inputs: ReportInputs, meta: ExportMeta): CsvFile         // meals and activities in one file with a `type` column (meal|activity), IST date/time, names, quantities and calories, activity source/duration/distance/HR, calories_estimated; excluded activities omitted; sorted by date then time
buildPdfModel(summary: RangeSummary, insights: string[], meta: ExportMeta): PdfDocModel
buildWeeklyEmail(summary: RangeSummary, insights: string[], meta: WeeklyEmailMeta): EmailContent
```

PDF model content: title "FitTrack report", the range label and generated-at line, a stats block (days logged, avg in, avg out (estimated), avg net, days on target, active time), the estimated weight change with the 7,700 kcal note, daily table, macro table (avg vs target), meal-slot table, activity-by-type table, top foods, HR only when `hr.hasData`, weight and progress, insights bullets, chart blocks (`inOut`, `net`, `slots`, `macros`, `weight`, plus `hr` when data) each with an `alt` text summary, and a closing note "BMI and calorie figures are estimates and not medical advice. Calories out are estimated." Every estimated value says so.

Weekly email content: subject `Your FitTrack week: <range>`; greeting by name when present; the key numbers (days logged, avg in vs target, avg out (estimated), net, days on target, active time, estimated weight change), up to 4 insights, a button-style link to the app, a footer with the disclaimer and the unsubscribe link. HTML uses inline styles and tables only, works in dark mode clients (no white-on-white), escapes all text. A plain-text alternative contains the same facts and the unsubscribe URL. No NaN/Infinity/"undefined" anywhere.

## DB (`0008_email.sql`)

Adds the two profile columns, `app_config`, `send_weekly_summaries()` (security definer, `search_path = public`, execute revoked from `public, anon, authenticated`) and a guarded pg_cron schedule (`fittrack-weekly-summary`, `30 2 * * 1`). The migration must not fail on a project where pg_cron or pg_net is not enabled yet (guard with `to_regnamespace`/exception handling and `raise notice`); `supabase/README.md` explains enabling the extensions (Database, Extensions) and inserting the two `app_config` rows.

## Frontend (src/features/**)

- **Reports**: **Export** control with *Daily CSV*, *Entries CSV* and *PDF* (the PDF library `jspdf` and `jspdf-autotable` are imported dynamically only when PDF is chosen). CSV: `buildDailyCsv` / `buildEntriesCsv` then a Blob download (works on iOS/Android browsers: object URL with `download`, revoke after use). PDF: `buildPdfModel` then render with jsPDF (A4 portrait, readable fonts, tables with autotable, page numbers, estimated labels, disclaimer on the last page); for `chart` blocks rasterise the matching on-screen Recharts SVG to PNG via canvas (white background, light theme colours) when it is on screen, otherwise print the `alt` text; failures in a chart must never stop the PDF. Show progress/disabled state, a success toast and a readable error. Export reflects exactly the range on screen and works offline for already loaded data. For the entries CSV the inputs come from the already loaded `ReportInputs`.
- **Settings**: a **Weekly summary email** toggle bound to `profiles.email_weekly` (optimistic with rollback and an error message), explanatory text (Mondays about 8:00 IST, summary of the previous 7 days, can be switched off any time, needs the server email setup), and an **Install app** card using `useInstallPrompt()` from `src/lib/pwa.ts` (button when installable, iOS "Share, then Add to Home Screen" hint on iOS Safari, "Installed" state, hidden otherwise).
- Keep all earlier behaviour and tests passing. No new runtime dependencies beyond `jspdf`/`jspdf-autotable` (already installed).

## PWA (orchestrator)

`vite-plugin-pwa` (generateSW, `registerType: "prompt"`), manifest (standalone, theme and background colours, 192/512 and maskable icons, shortcuts for Add meal and Add activity), precache of the app shell and all built assets, SPA navigation fallback that excludes `/api/`, runtime cache only for reference data (`foods`, `activity_types` REST GETs: StaleWhileRevalidate, capped), **never** user tables, auth or `/api/*`. Update prompt and offline-ready toast component, `useInstallPrompt`, `_headers` (no-cache for the service worker, immutable assets, security headers, Content-Security-Policy in **report-only** mode first).
