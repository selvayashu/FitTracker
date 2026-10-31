# Activity File Import Contract (GPX and TCX)

Adds an **Import activity file** feature so workouts exported from a watch app (for example Amazfit/Zepp, Garmin, Apple Watch tools, Strava's own downloadable files) can be added without any API. FROZEN: this file, `packages/shared/src/importTypes.ts`. Earlier contracts and the skill's non-negotiable rules still apply.

## Ownership

| Owner | Paths |
|---|---|
| Shared agent | `packages/shared/src/activityFiles.ts`, `packages/shared/src/activityFiles.test.ts`, and the one-line `export * from "./activityFiles";` in `packages/shared/src/index.ts` (replace the placeholder comment) |
| Frontend agent | `src/features/activity/import/**` (new) and the minimal wiring in `src/features/activity/ActivityPage.tsx` (an "Import file" button that opens the sheet) |
| Orchestrator | everything else, including the contract and README |

## Principles

- **Parse in the browser; nothing is uploaded.** GPS points are used only for distance and timing and are discarded; only summary numbers and HR samples are kept in memory, and only summary numbers (plus HR zone seconds) are stored.
- **No new dependencies.** GPX and TCX are small XML dialects; the Shared agent writes a tolerant tag scanner (no DOM, no entity expansion, no DTD processing; it must run in Node tests and browsers).
- **Imported workouts are ordinary editable activities**: `source = "manual"`, `notes = "Imported from <file name>"`, calories from the file when present (not estimated) else a MET estimate (estimated).
- **Idempotent:** the activity `id` is deterministic from the user and the workout content, so importing the same file twice never creates a duplicate; existing ids are skipped (never overwritten, so a user's edits survive a re-import).
- **Validate:** duration 1 to 600 minutes (database CHECK), start not in the future, HR samples 40..220 only, a workout spanning more than 24 hours is rejected with a clear message. Max 10 MB per file and 20 files per batch.
- **Time zones:** GPX/TCX timestamps are normally UTC (`Z`). A timestamp without `Z` or an offset is read as UTC unless the caller passes `assumeTz: "ist"`, and the workout is flagged `timeWasAssumed` so the UI can ask the user.

## Shared API (`packages/shared/src/activityFiles.ts`, pure)

```ts
detectFormat(text: string): ActivityFileFormat | null                       // looks at the root element (<gpx> or <TrainingCenterDatabase>), tolerant of a BOM, XML declaration, comments, namespaces
parseActivityFile(text: string, opts?: ParseOptions): ParseResult            // see below
mapFileSport(hint: string | null): { typeName: string; custom: string | null }   // to a seeded activity_types name (see below)
validateParsedWorkout(w: ParsedWorkout, now?: Date): string[]                // blocking problems (empty array = importable)
deterministicActivityId(userId: string, w: ParsedWorkout): Promise<string>   // RFC 4122 UUID (version 5 style) from SHA-256 of `${userId}|${startTime}|${Math.round(elapsedSec)}|${distanceKm ?? ""}` using globalThis.crypto.subtle
buildImportRow(w: ParsedWorkout, ctx: { userId: string; id: string; fileName: string; typeIdByName: Record<string, number>; metByTypeId: Record<number, { met_light: number; met_moderate: number; met_vigorous: number }>; weightKg: number | null; maxHr: number | null }): ImportActivityUpsert
hrZoneSecondsForWorkout(w: ParsedWorkout, maxHr: number): [number, number, number, number, number] | null   // uses the existing timeInHrZones; null when no HR samples
```

### parseActivityFile

- **GPX 1.0/1.1:** each `<trk>` is one workout (all its `<trkseg>` points together). Points: `<trkpt lat lon>` with `<time>`, optional `<ele>`, heart rate in an extension element whose local name is `hr` (any prefix: `gpxtpx:hr`, `ns3:hr`, `hr`), sometimes `heartrate`. Name from `<trk><name>`; sport from `<trk><type>`; also `<metadata><name>`. Distance: sum of haversine distances between consecutive points (ignore jumps over 5 km between consecutive points and points with missing coordinates); if the file has no usable coordinates, `distanceKm` is null. Elevation gain: sum of positive `ele` deltas after a small smoothing (ignore changes below 1 m); null without `ele`.
- **TCX:** each `<Activity Sport="...">` is one workout (all `<Lap>`s together). Use lap totals when present (`TotalTimeSeconds`, `DistanceMeters`, `Calories`, `AverageHeartRateBpm`, `MaximumHeartRateBpm`) and trackpoints (`<Time>`, `<DistanceMeters>`, `<HeartRateBpm><Value>`, `<AltitudeMeters>`) for HR samples and as fallbacks. Start time from the activity `<Id>` or the first lap `StartTime`/trackpoint.
- Heart-rate average: time-weighted over samples (each sample weighted by the gap to the next, gaps capped at 30 s); max is the largest valid sample. Samples outside 40..220 are dropped with a warning. When only lap averages exist, use them.
- Pauses: `movingSec = elapsedSec` minus the sum of gaps above 30 s between consecutive points; null when there are fewer than 2 timestamps.
- Errors (`ok: false`, plain-language message): not XML, empty, unknown format, no workouts found, no timestamps in any workout. A file with several workouts where some are unusable returns the usable ones and puts a note in `warnings`.
- Hostile input: never expand entities beyond the five predefined ones and numeric references; ignore `<!DOCTYPE ...>` and `<!ENTITY ...>` completely; cap work (for example refuse text over 12 million characters); no recursion depth issues on deeply nested tags (iterative scanner).

### mapFileSport

Case-insensitive, trims; strips `Sport=`/`type` prefixes like `1`/`running` style values; map: running/run/trail running/treadmill -> Running; walking/walk/hiking/hike -> Walking; "brisk" or "fast walking" -> Brisk walking; cycling/biking/bike/ride/mountain biking/indoor cycling -> Cycling; swimming/swim/pool swim/open water -> Swimming; yoga -> Yoga; strength/gym/weight training/workout/fitness -> Gym / Strength training; hiit/interval -> HIIT; elliptical/stair/stepper -> Stair climbing; jump rope/skipping -> Skipping; badminton, tennis, football/soccer, cricket, dance -> their seeded names; empty or unknown -> `{ typeName: "Other", custom: <the hint cleaned to Title Case or "Workout"> }`. Names must exactly match `supabase/migrations/0003_seed_activity_types.sql`.

### buildImportRow

`duration_min = clamp(round((movingSec ?? elapsedSec) / 60), 1, 600)` (callers validate first); `intensity` from `intensityFromHr(avgHr, maxHr)`; calories: the file's value when it is a positive number (`calories_estimated = false`), else MET estimate via `metKcal` with the type's MET for the intensity and `weightKg` (`calories_estimated = true`), or `null` (estimated true) without a weight; `custom_name` only for "Other"; `notes = "Imported from <fileName>"` (and the workout's own name appended in parentheses when it has one, truncated to 200 characters); `avg_hr`/`max_hr` rounded, null when outside 40..220.

## Frontend: `src/features/activity/import/`

**Import file** button on the Activity page opens a sheet (`ImportSheet`) that:
1. Lets the user choose one or more `.gpx` / `.tcx` files (multiple allowed, max 20 files, 10 MB each; show a clear message for others), with a short note: "Your file is read on this device. It is not uploaded. Location data is not stored."
2. Parses with `parseActivityFile`, with a switch **"These files use India time (IST), not UTC"** (re-parses without needing to re-pick files; shown only when some workout has `timeWasAssumed`).
3. Shows one preview row per workout: sport (mapped type, editable via a select of the activity types), start (IST), duration, distance, avg/max HR, calories (labelled "estimated" when estimated), HR-zone availability, warnings, a checkbox, and a status: **Ready**, **Already imported** (id already exists), **Looks like an activity you already logged** (same type within 30 minutes of an existing activity: use `findDuplicateCandidates` against that user's existing activities for the covered dates; unchecked by default), or **Can't import: <reason>** (disabled, from `validateParsedWorkout`).
4. **Import N workouts** writes with direct Supabase calls (the HR-zone table is not in the offline outbox, so import requires a connection; say so when offline): insert the `activities` rows with `upsert(..., { onConflict: "id", ignoreDuplicates: true })`, then insert `activity_hr_zones` rows (zone seconds from `hrZoneSecondsForWorkout`, `max_hr_used` = the profile max HR or 220 minus age) for workouts with HR data. Handle partial failure per workout and report "Imported X, skipped Y, failed Z" with reasons. Refresh the Activity list afterwards.
5. States: loading/parsing, error banner per file, empty selection, success summary. Accessible labels, dark mode, mobile first, no horizontal scroll at 360 px.
Profile weight and max HR come from `useProfile()`; if weight is missing, imported calories without file calories stay empty and are flagged estimated (tell the user to complete their profile).
Pure logic (status decisions, summary text, file validation, row assembly) in separate functions with Vitest tests.
