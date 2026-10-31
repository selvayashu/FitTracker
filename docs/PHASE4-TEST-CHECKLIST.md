# Phase 4 Test Checklist (PWA, Export, Weekly Email)

> **Draft written from `docs/CONTRACT-PHASE4.md` while the export screens and email endpoints were still being built.** It will be re-checked against the finished code before you test; if something here does not match the app, treat it as a checklist bug and tell me.

Covers: installable offline-capable app (PWA), CSV and PDF export from Reports, the weekly summary email with unsubscribe, and the new security headers.
Needs the deployed Cloudflare Pages site (service workers, headers and the email endpoints do not run on a plain `vite preview`). Phases 1 to 3 should already work.
**Record every failure** (screen, steps, expected vs actual, browser console, Cloudflare Functions logs).

Mark each item: [x] pass, [!] fail (add a note), [-] skipped.

## A. Setup

- [ ] Run Supabase migration `0008_email.sql` (after 0001-0007). No errors. `profiles` has `email_weekly` (default false) and `last_weekly_email_at`; table `app_config` exists.
- [ ] Supabase, Database, Extensions: enable **pg_cron** and **pg_net**. Re-run the schedule part of `0008` (or follow `supabase/README.md`). `select * from cron.job;` shows `fittrack-weekly-summary` with schedule `30 2 * * 1`.
- [ ] Create a Resend account and API key. (Sandbox sender only delivers to your own Resend account email; fine for testing.)
- [ ] Cloudflare secrets added and site redeployed: `RESEND_API_KEY`, `CRON_SECRET`, `EMAIL_TOKEN_SECRET` (and optionally `EMAIL_FROM`). `SUPABASE_SERVICE_ROLE_KEY` is already set from Phase 2.
- [ ] In Supabase: `insert into app_config ...` with `email_endpoint_url` (`https://YOUR-SITE/api/email/weekly`) and `cron_secret` (identical to the Cloudflare `CRON_SECRET`).
- [ ] Automated checks green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; database tests `cd supabase/tests && npm test` (169 passing).

## B. Install and offline (PWA)

- [ ] Chrome or Edge on desktop or Android: the install icon appears in the address bar (or **Settings, Install app** shows an install button). Installing opens FitTrack in its own window with the teal pulse icon and no browser bars.
- [ ] The installed app name is "FitTrack"; the icon looks right on the home screen/launcher, including the maskable (rounded or circular) crop on Android.
- [ ] Long-press the installed icon on Android: shortcuts **Add a meal** and **Add an activity** open the right screens.
- [ ] iPhone, Safari: **Settings** shows "Tap Share, then Add to Home Screen". After adding, the icon and name are right and the app opens full screen.
- [ ] Already installed: the Settings card says **Installed** (no install button).
- [ ] DevTools, Application: the manifest has no errors; Service Workers shows `sw.js` activated; Lighthouse "Installable" passes.
- [ ] First load shows a one-time "FitTrack is ready to work offline" message.
- [ ] **Offline start:** after one online visit, switch DevTools to Offline (or airplane mode) and reload: the app opens (no browser dinosaur page) and a signed-in user sees Today, Meals and Activity.
- [ ] **Offline entry:** while offline add a meal and an activity: both appear immediately and the offline banner shows items waiting; go back online and they sync exactly once (no duplicates), as in the Phase 1 checklist.
- [ ] **Offline food search:** foods you searched earlier still appear in the food search offline (cached reference data); the list of activity types still loads.
- [ ] DevTools, Application, Cache Storage: the runtime cache `fittrack-reference-data` holds only `.../rest/v1/foods` and `.../rest/v1/activity_types` entries. **Nothing** from `/api/`, auth, `meal_entries`, `activities`, `profiles` or `weight_logs` is stored there.
- [ ] Deep links work offline and online (reload on `/meals`, `/reports`, `/settings`).
- [ ] `/api/strava/...` and `/api/email/...` are never answered by the service worker's offline page (offline they simply fail, with an error message in the app).
- [ ] **Update flow:** deploy a small visible change; with the app open, wait or reload once: a bar says "A new version of FitTrack is ready" with **Reload** and **Later**. **Later** keeps your current page and any open form untouched; **Reload** loads the new version. The app never reloads by itself.
- [ ] After an update, queued offline entries are still there and sync.

## C. Security headers

- [ ] Response headers on the site (DevTools, Network, the HTML document) include `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, and `Content-Security-Policy-Report-Only`.
- [ ] `sw.js`, `index.html` and `manifest.webmanifest` are served with `Cache-Control: no-cache`; files under `/assets/` are `immutable` with a one-year max-age.
- [ ] Use every screen with the browser console open (login, onboarding, meals incl. an Open Food Facts search, activity, Strava connect/sync, weight, reports with charts, **PDF export**, settings, install prompt): the console shows **no** "Content Security Policy" violations. Note any that appear (blocked source and page).
- [ ] If clean: rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `public/_headers`, redeploy, and repeat the walkthrough above. Everything still works.
- [ ] The site cannot be embedded in another site's iframe.

## D. Export (Reports)

Use a Week range that contains meals, activities and (if you use Strava) heart-rate data; also test one empty range.

- [ ] An **Export** control offers **Daily CSV**, **Entries CSV** and **PDF**. It is disabled while loading and for an empty range, with a hint.
- [ ] **Daily CSV:** the file is named like `fittrack-daily-2026-03-05_to_2026-03-11.csv`; it opens in Excel with correct characters and columns (UTF-8 BOM, no garbled symbols); one row per day; a day with no meals has **empty** intake, net and on-target cells (not 0); `*_estimated` columns are present; numbers match the Reports screen for the same range (average in/out, active minutes, workouts).
- [ ] **Entries CSV:** one file with both meals and activities (`type` column); dates and times are IST; hidden (excluded) Strava duplicates are **not** included; sorted by date and time; a Strava activity shows source `strava`.
- [ ] **Formula injection guard:** create a custom food named `=1+1` (and one named `@SUM(A1)`), log it, export the entries CSV and open it in Excel or Sheets: the name is shown as text (leading `'`), never calculated.
- [ ] A food name with a comma and a double quote (for example `Dal, "special"`) appears correctly in one cell.
- [ ] **PDF:** the file is named like `fittrack-report-2026-03-05_to_2026-03-11.pdf`, A4, opens in a PDF viewer. It contains the title, the range and the generated time in IST, key stats, the estimated weight change note (7,700 kcal is about 1 kg), the daily table, macro and meal-slot tables, activity by type, top foods, weight/progress, insights, and the closing disclaimer.
- [ ] Charts appear in the PDF (calories in vs out, net, and others). If you deliberately export with the chart section collapsed or unavailable, the PDF still downloads with a text summary instead of that chart.
- [ ] Heart-rate section appears in the PDF **only** when the range has HR data.
- [ ] Every estimated value is marked estimated; there is no "NaN", "undefined" or "null" text anywhere in the PDF or the CSVs.
- [ ] A long range (Month or a 100-day Custom range) produces a multi-page PDF with page numbers ("Page 2 of 3") and no text running off the page.
- [ ] While generating, the button shows "Preparing..." and the page stays usable; afterwards a message confirms the file name.
- [ ] Export works offline for an already loaded report (download still succeeds).
- [ ] Export on a phone (Android Chrome and iPhone Safari): the files download or open in the share sheet.
- [ ] The PDF library is only downloaded when you choose PDF (DevTools, Network: the jsPDF chunk loads on click, not on page load).
- [ ] The exported figures equal the on-screen Reports figures for the same range.

## E. Weekly summary email

- [ ] **Settings, Weekly summary email**: the switch is off by default, explains the Monday morning (about 8:00 IST) schedule, and saves immediately. Reloading keeps the setting. A failed save (block the network) rolls the switch back and shows an error.
- [ ] With the switch **on** and meals logged in the previous 7 days, run the manual trigger from the README (`curl ... "force": true`). The response is `{"sent":true}` and an email arrives within a minute (check spam too).
- [ ] Email content: subject "Your FitTrack week: <range>"; greeting with your name; days logged "N of 7"; average intake, average out (estimated), average net, days on target, active time, estimated weight change; up to 4 insights; an **Open FitTrack** link that opens the app; the disclaimer; an unsubscribe link. Numbers match the Reports screen for the same 7 days (3 Mar to 9 Mar style: the 7 IST days ending **yesterday**).
- [ ] The email is readable in a light client **and** a dark-mode client (Gmail app and Outlook or Apple Mail, if you have them): no white text on a white background, links visible.
- [ ] Gmail's "Unsubscribe" header link appears next to the sender (List-Unsubscribe).
- [ ] **Not opted in:** with the switch off, the trigger returns `{"sent":false,"reason":"not_opted_in"}` and nothing is sent.
- [ ] **Sent twice quickly:** a second trigger within 6 days (without `force`) returns `recently_sent` and sends nothing. `profiles.last_weekly_email_at` was set by the first send.
- [ ] **No data:** an account with no logged meals in the previous 7 days returns `no_data` and no email is sent.
- [ ] Wrong or missing `x-cron-secret` returns 401; nothing is sent.
- [ ] **Resend failure** (temporarily use a wrong API key): the response is a 502 `send_failed`, and `last_weekly_email_at` is **not** updated. Restore the key.
- [ ] **Scheduler:** `select public.send_weekly_summaries();` returns the number of users queued (1 for you if eligible); then `select * from net._http_response order by created desc limit 5;` shows a 200 response from the endpoint, and the email arrives. A user mailed less than 6 days ago is skipped.
- [ ] After the first Monday run, `select * from cron.job_run_details order by start_time desc limit 5;` shows a successful run and the email arrived around 08:00 IST.

## F. Unsubscribe

- [ ] Click the unsubscribe link in the email: a page asks you to confirm and **does not unsubscribe yet**. (Opening the link must not change your setting.)
- [ ] Press the button: a confirmation page appears and the Settings switch is now **off** after a reload.
- [ ] Gmail's one-click "Unsubscribe" also turns the switch off.
- [ ] A tampered link (change a character in the token) shows an error page and changes nothing. A link made for another user cannot unsubscribe you.
- [ ] After unsubscribing, the manual trigger returns `not_opted_in`.

## G. Install card and Settings

- [ ] The Install card shows the right state in each browser (button, iOS hint, installed, or hidden when the browser offers nothing).
- [ ] Settings still saves profile, tracking mode and Strava as before; layout is fine at 360 px in light and dark mode.

## H. Security

- [ ] With your user token, `curl "https://PROJECT.supabase.co/rest/v1/app_config?select=*" -H "apikey: ANON_KEY" -H "Authorization: Bearer USER_TOKEN"` returns a permission error or no rows: the cron secret is never readable.
- [ ] `select public.send_weekly_summaries()` as a normal signed-in user (through the REST `rpc`) is refused.
- [ ] The built site (`dist`) and the network traffic contain no `RESEND_API_KEY`, `CRON_SECRET`, `EMAIL_TOKEN_SECRET` or service-role key.
- [ ] A second account cannot change or read the first account's `email_weekly` or `last_weekly_email_at`.
- [ ] Nothing in Cloudflare's real-time logs contains your email address, tokens or secrets after a send.

## I. Regression

- [ ] Phases 1 to 3 checklists still pass on the deployed, installed app (spot-check: sign-in, meal entry, manual activity, Strava sync, Today, Reports).
- [ ] The first screen still loads quickly: the chart and PDF code load on demand.
- [ ] Manual-mode users still make no `/api/strava` calls.

## Known limitations

- The email's look in real mail clients has not been tested by automated tests; the scheduler and Resend were only exercised with fakes.
- The sandbox sender only delivers to your own Resend account address until you verify a domain.
- The weekly email goes out Monday about 08:00 IST for everyone; there is no per-user time or day.
- Calories out in the PDF, CSV and email are estimates.
- The Content Security Policy is report-only until you flip it after testing.
- Offline: your personal data is not cached by the service worker; only entries you add offline (kept on the device and synced later) and the cached food and activity-type lists are available without a connection. The Reports and Today screens need a connection for fresh data.
- iOS Safari has no install prompt; use Share, Add to Home Screen.

## Reporting back

For each failure send: section and item, steps, expected and actual, a screenshot if helpful, the browser console text, and any Cloudflare Functions log lines. When you are happy with Phase 4, say so. Then the build is complete, and the remaining work is fixing whatever your testing finds.
