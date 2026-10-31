# Phase 2 Test Checklist (Strava)

Covers: Strava connect, 90-day sync, webhook updates, heart-rate zones, duplicate handling, disconnect.
> **Important:** Strava now requires a Strava **subscription** to create an API app. Without one this whole checklist cannot be run; use manual entry or the file import instead.

Prerequisite: Phase 1 works (see `docs/PHASE1-TEST-CHECKLIST.md`). Nothing in Phase 2 has run against real Strava or Supabase yet, so **record every failure** (screen, steps, what you saw, browser console and Cloudflare logs).

Mark each item: [x] pass, [!] fail (add a note), [-] skipped.

## A. Setup

Strava's callback and webhook need a public URL, so test on the deployed Cloudflare Pages site (local testing with `wrangler pages dev` is possible but the Strava callback domain must then be `localhost`).

- [ ] Run Supabase migrations `0006_strava.sql` and `0007_strava_id_unique.sql` (after 0001-0005). No errors. Table Editor shows `strava_connections` and `activity_hr_zones`.
- [ ] Create the Strava API app at https://www.strava.com/settings/api. Authorization Callback Domain = your Pages domain only (for example `fittrack.pages.dev`, no `https://`). Note the Client ID and Secret.
- [ ] Deploy the app to Cloudflare Pages from GitHub (build `npm run build`, output `dist`) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- [ ] In Cloudflare, add these as **Secrets**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` (any random string), `STRAVA_STATE_SECRET` (32+ random characters). Redeploy.
- [ ] Confirm `SUPABASE_SERVICE_ROLE_KEY` appears **only** in Cloudflare, not in `.env.local`, the repo or the browser.
- [ ] In Supabase, Authentication, URL Configuration: your Pages URL is allowed.
- [ ] Open `https://YOUR-SITE/api/strava/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=abc` in a browser: **403**. With the correct verify token it returns `{"hub.challenge":"abc"}`.
- [ ] Register the webhook (README section 7d). The response is `{"id": ...}`. Add that id as the Cloudflare secret `STRAVA_SUBSCRIPTION_ID` and redeploy.
- [ ] Automated checks still green: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; database tests `cd supabase/tests && npm test` (137 passing).

## B. Connect

- [ ] With the tracking mode on **Manual**, open DevTools, Network: there are **no** requests to `/api/strava/*` on Home, Activity or Settings.
- [ ] Settings, switch tracking to Strava, tap **Connect Strava**. You are redirected to Strava with scopes `read` and `activity:read_all` shown.
- [ ] Untick "View data about your activities" and authorize: you return to Settings with a clear message that activity access is needed, and **no** connection is stored.
- [ ] Cancel on the Strava screen: you return with a "connection cancelled" style message, nothing stored.
- [ ] Connect properly: you return to `/settings?strava=connected`, the success banner appears, the query string is removed from the address bar, and the status shows your athlete connection.
- [ ] Reloading `/settings` does not repeat the success banner or restart a sync.
- [ ] Onboarding path: a fresh account choosing Strava during onboarding goes to Strava after saving the profile. If you cancel, you land back in the app in manual mode with a message.
- [ ] `strava_connections` has one row for you (check in the Supabase Table Editor, which uses the service role). Token columns are filled; `expires_at` is a future time.

## C. Initial sync (last 90 days)

- [ ] After connecting, a 90-day sync starts automatically with a progress indicator (counts going up).
- [ ] Activities appear in the Activity list with a **Strava** badge, name, time (IST), duration, distance, and avg/max HR where Strava has them.
- [ ] Count check: the number of Strava activities in the last 90 days roughly matches Strava's own count. Private activities and activities you have not allowed may be missing (note which).
- [ ] A big history finishes across several batches without freezing the page; navigating to another screen and back does not duplicate work.
- [ ] Open the same account in a **second tab** during a sync: it shows "a sync is already running" and does not hammer the server (Network tab shows spaced requests, not a rapid burst).
- [ ] Time check: a Strava activity that started at 06:30 IST shows 06:30 in the app, and the row in Supabase has `01:00:00+00`.
- [ ] Sync again with **Sync now**: no duplicates are created; row count stays the same.
- [ ] `last sync` time in the card and the sync chip is updated.

## D. Calories and heart-rate zones

- [ ] An activity where Strava has calories shows them **without** an "estimated" tag.
- [ ] An activity without Strava calories (often manual Strava entries) shows an estimate marked **estimated**; the value equals MET x weight x hours (Walking moderate, 68 kg, 40 min = 159 kcal).
- [ ] An activity with heart-rate data shows a zone bar with zones 1-5 and minutes per zone; the minutes add up to roughly the moving time. A short stop (pause) is not counted as time in a zone.
- [ ] The zone card states the max HR used (default 220 minus age). Change max HR in Settings: new activities use the new value, old zone rows keep theirs.
- [ ] An activity without heart-rate data shows no zone bar and no error.
- [ ] `activity_hr_zones` rows exist for those activities, one per activity.
- [ ] Elevation and suffer score are shown when Strava provides them.

## E. Duplicates

- [ ] Add a **manual** Walking activity today at 06:30 (40 minutes). Then record or find a Strava **Walk** that started between 06:00 and 07:00 (or add the manual entry to match an existing Strava activity), and run **Sync now**.
- [ ] The Strava row shows a duplicate banner naming the manual activity, with **Keep Strava**, **Keep manual** and **Not a duplicate**.
- [ ] Different type (Run vs Walk) at the same time: **no** banner. Same type 31 minutes apart: **no** banner. Same type 29 minutes apart: banner.
- [ ] **Keep Strava**: the manual row is deleted; the Strava row remains and the banner disappears.
- [ ] **Keep manual**: the Strava row disappears from lists and totals; check Supabase: it still exists with `excluded = true`. Run **Sync now** again: it does **not** come back.
- [ ] **Not a duplicate**: banner disappears, both stay, and it does not return after another sync.
- [ ] Offline: the three buttons are disabled with an explanation.
- [ ] `daily_summaries` for that day does not count an excluded row.

## F. Webhook (live updates, no manual sync)

Requires the webhook to be registered and `STRAVA_SUBSCRIPTION_ID` set.

- [ ] Record or manually add a new activity in Strava: it appears in FitTrack within about a minute **without** pressing Sync.
- [ ] Rename the activity in Strava: the name updates in FitTrack. If you had added a **note** in FitTrack first, the note is **kept**.
- [ ] Edit your note in FitTrack on a Strava activity: other fields (duration, calories, HR) are not changed by that edit.
- [ ] Delete the activity in Strava: it disappears from FitTrack (the Worker verifies with Strava first).
- [ ] Make an activity private in Strava: FitTrack does not crash; it keeps the old row.
- [ ] Forged event: `curl -X POST https://YOUR-SITE/api/strava/webhook -H "Content-Type: application/json" -d '{"object_type":"athlete","aspect_type":"update","updates":{"authorized":"false"},"owner_id":YOUR_ATHLETE_ID,"subscription_id":1}'` returns 200 and your connection **remains** (Settings still shows connected).
- [ ] Malformed body (`-d 'not json'`) returns 200 and nothing changes.
- [ ] Deauthorize in Strava (Settings, My Apps, Revoke Access): within a minute FitTrack shows the account as disconnected; the synced activities remain.

## G. Disconnect

- [ ] Settings, **Disconnect**: a confirmation offers "Also delete synced activities", **unchecked** by default.
- [ ] Disconnect without deleting: status shows not connected; the activities stay; `strava_connections` row is gone.
- [ ] Reconnect: sync resumes, no duplicate activities (same `strava_id`).
- [ ] Disconnect **with** the box ticked: all `source = strava` activities are removed; manual ones stay.
- [ ] If Strava is unreachable when disconnecting, the connection is still removed locally and the message says the Strava-side revoke may be needed.
- [ ] In Strava's My Apps list, FitTrack disappears after disconnect.

## H. Errors and limits

- [ ] Wrong `STRAVA_CLIENT_SECRET` (temporarily): Connect shows a clear configuration error, and existing connections are **not** deleted by a failed refresh. Restore the secret afterwards.
- [ ] Rate limit (optional, hard to trigger): if a sync reports "Strava is limiting requests", a countdown is shown, the sync resumes automatically, and it stops retrying after a sensible number of attempts.
- [ ] Airplane mode during a sync: a network message appears; going back online and tapping **Sync now** works; a failed offline attempt does **not** block the automatic sync for 15 minutes.
- [ ] Auto-sync: opening the app while connected runs one incremental sync, at most once every 15 minutes (check the Network tab after reopening twice within 15 minutes: only one run).
- [ ] The sync chip on Home and Activity shows last sync / syncing / error states correctly.

## I. Security

- [ ] In the browser, token columns are not reachable. With your user token: `curl "https://PROJECT.supabase.co/rest/v1/strava_connections?select=*" -H "apikey: ANON_KEY" -H "Authorization: Bearer USER_ACCESS_TOKEN"` returns a permission error or no rows, never tokens.
- [ ] `select * from strava_status()` as your user returns only connected, athlete id, last sync and scope.
- [ ] Calling `/api/strava/sync` without a bearer token returns 401; with a garbage token returns 401.
- [ ] Wrong HTTP method (for example GET on `/api/strava/sync`) returns 405.
- [ ] Search the built site (`dist`) and Network responses for your Strava secret or the service role key: not present.
- [ ] A second FitTrack account cannot see the first account's Strava activities or zones.

## J. Regression (Phase 1 still works)

- [ ] With Strava connected, manual activity entry, edit and delete work. Manual rows are never changed by a sync.
- [ ] A user in manual mode sees no Strava UI errors and makes no `/api/strava` calls.
- [ ] Meals, weight and settings behave as in the Phase 1 checklist.
- [ ] Dark mode looks right on the Strava card, sync chip, zone bar and duplicate banner. Layout is usable at 360 px.

## Known limitations

- A new Strava app only serves your own account until Strava approves it.
- Default Strava limits: 100 requests per 15 minutes and 1,000 per day. A first import of a very large history can take several passes.
- Each sync call processes only a handful of activities because of Cloudflare's free-tier limit of about 50 outbound requests per invocation; the browser repeats the call until done.
- Pause time in heart-rate zone calculation is capped, so zone minutes can be slightly below total moving time.
- Offline duplicate resolution is disabled by design.
- Real Strava, Supabase and Cloudflare behaviour has not been exercised by automated tests, only by fakes.

## Reporting back

For each failure send: section and item, steps, expected result, actual result, any red browser-console text, and the Cloudflare Pages Functions log lines (Cloudflare dashboard, your project, Functions, Real-time logs). When you are happy with Phase 2, say so and I will start Phase 3 (dashboard and reports).
