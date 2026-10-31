# Activity File Import and Connections: Test Checklist

Covers: **Activities, Import file** (GPX and TCX), the **Connections** screen, and the friendly Strava "not set up" messages.
Needs the live site (https://fittrack-101.pages.dev) or `npm run dev`, signed in, with Phase 1 working.
**Record every failure** (screen, steps, expected vs actual, browser console).

Mark each item: [x] pass, [!] fail (add a note), [-] skipped.

## A. Try it with the two synthetic sample files (no Zepp file needed)

The files are in the repo at `docs/samples/` (made-up coordinates, not a real place):
`sample-walk.gpx` and `sample-run.tcx`. Download them from https://github.com/selvayashu/FitTracker/tree/main/docs/samples if you are testing from another device.

- [ ] Open **Activity** and tap **Import file**. The note says the file is read on this device, is not uploaded, and location data is not stored.
- [ ] Choose **both** sample files together. Two preview rows appear.
- [ ] **Walk row** shows: type **Walking**, start **30 Oct, 06:00** (IST), about **40 min**, distance about **3.3 km**, average HR about **115**, max **135**, calories **estimated** (the file has none; with a 68 kg profile that is about 159 kcal for a moderate walk), and a heart-rate zones badge.
- [ ] **Run row** shows: type **Running**, start **29 Oct, 06:30** (IST), **30 min**, about **4.8 km**, average HR about **159**, max **170**, calories **300 and not tagged estimated** (they come from the file), zones badge.
- [ ] Both rows say **Ready** and are ticked. Tap **Import 2 workouts**. A summary says 2 imported, 0 failed.
- [ ] Both appear in the Activity list under the right days, with "Imported from sample-walk.gpx" / "sample-run.tcx" in their notes, and the HR zone bars show.
- [ ] In Supabase (`select start_time, duration_min, distance_km, avg_hr, calories, calories_estimated, source, notes from activities order by created_at desc limit 2;`): `source` is `manual`, the run's start is `2026-10-29 01:00:00+00`, the walk's is `2026-10-30 00:30:00+00`.
- [ ] `select * from activity_hr_zones order by created_at desc limit 2;` shows two rows with whole-number seconds in zones 1 to 5.
- [ ] **Import the same two files again:** both rows say **Already imported**, are disabled and unticked, and nothing is duplicated.
- [ ] Edit one imported activity (change its notes), then re-import its file: your edit is **not** overwritten.
- [ ] **Overlap check:** add a manual Walking activity on 30 Oct at 06:15 (30 minutes). Import `sample-walk.gpx` again... it will say "Already imported", so instead delete the imported walk first, then re-import: the row now says **Looks like an activity you already logged** and is **unticked**. Tick it and import: both exist and the duplicate review handles them as before.
- [ ] Change the **type** of a row in the preview (for example Walking to Yoga) before importing: the saved activity uses the new type.
- [ ] Choose "Other" in the preview: a custom name is required and saved.

## B. Time zones

- [ ] Open `sample-walk.gpx` in Notepad and delete the `Z` from every `<time>` value (Find and Replace `Z</time>` with `</time>`), save as `walk-nozone.gpx`. Import it: the sheet shows the switch **"These files use India time (IST), not UTC"**. With it off the start reads 30 Oct, **11:30**; turning it on moves it to **06:00** without picking the file again.
- [ ] A file whose times already end in `Z` does not show the switch.

## C. Bad and unusual files

- [ ] A text or image file renamed `.gpx` shows a plain-language error for that file, and a second good file in the same batch still previews.
- [ ] A file over 10 MB, or choosing more than 20 files, is refused with a clear message.
- [ ] A GPX with no timestamps shows "Can't import" with a reason.
- [ ] A workout longer than 10 hours (edit a `<time>` to be later) shows "Can't import: ... 600 minutes".
- [ ] A workout dated in the future, or before the year 2000, shows "Can't import".
- [ ] **Offline:** with the network off, the Import button explains that import needs a connection (previewing a file still works).
- [ ] On a plain `http://` address (not localhost) the sheet says "Import needs a secure (https) connection" (live site is https, so this only appears in odd setups).

## D. Your real Zepp (Amazfit) file

- [ ] In the Zepp app on Android open a workout and look for **Export** or **Share as GPX** (names vary by version). Note exactly what options you see.
- [ ] Move the file to your computer or open the importer on the phone (the live site works in the phone's browser).
- [ ] Import it. Check against the Zepp app: start time, duration, distance, average and max heart rate. Tell me any difference of more than a minute or a few percent.
- [ ] If the start time is off by 5 hours 30 minutes, use the IST switch and tell me. That means Zepp writes local time without a zone marker.
- [ ] If the file does not import, send me its **first 30 lines** after removing any lines with latitude and longitude, so I can see the format without your location.

## E. Connections screen

- [ ] **Settings** has a link to **Connections**, and **Activity** has a small Connections link. The screen opens at `/connections`.
- [ ] Three cards: **Strava**, **Import an activity file**, **Add by hand**, each stating what it needs.
- [ ] **Strava card** (server not set up): shows "Strava is not set up on this server yet. Connecting needs a Strava developer app, and Strava requires a subscription to create one. You can bring your workouts in with a file instead." with a button that opens the import sheet. No raw error text and no red console errors.
- [ ] **Import card** opens the same sheet; the help section lists Zepp (Android), Garmin Connect and Strava export steps.
- [ ] In **manual** mode, DevTools Network shows **no** requests to `/api/strava/...` and none to the `strava_status` function while this screen is open.
- [ ] In Settings, switching tracking to **Strava** and trying **Connect Strava** shows a friendly message (not a raw error).
- [ ] Dark mode and a 360 px wide screen look right; the preview table never causes sideways scrolling.

## F. Regression

- [ ] Manual activity entry, edit, delete and offline entry still work as before.
- [ ] Reports, Today and CSV/PDF export include imported workouts (the run appears in activity-by-type, and its calories count as non-estimated).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` (588 passing) and `npm run build` are green.

## Known limitations

- **GPX and TCX only.** FIT files (binary) are not supported yet.
- The parsers were tested with hand-written fixtures built from the formats' conventions; no real Zepp, Garmin or Strava file has been tried yet, which is why section D matters.
- Imported workouts are saved as ordinary manual activities (source "manual") tagged with the file name; there is no separate "Imported" source in reports.
- Import needs a connection (the heart-rate zone table is not part of the offline queue).
- Calories without a value in the file are MET estimates (and need your weight in your profile).

## Reporting back

For each failure send: section and item, steps, what you expected and saw, a screenshot, and any red browser-console text. For a real Zepp file that misbehaves, send the first 30 lines with location values removed.
