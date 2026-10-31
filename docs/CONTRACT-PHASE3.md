# Phase 3 Contract (Dashboard and Reports)

FROZEN: this file, `packages/shared/src/reportTypes.ts`, `src/lib/rangeData.ts`. Report problems instead of editing them. Phase 1 and 2 contracts and the skill's non-negotiable rules still apply.

## Ownership

| Owner | Paths |
|---|---|
| Shared agent | `packages/shared/src/reports.ts`, `packages/shared/src/reports.test.ts`, and the one-line `export * from "./reports";` in `packages/shared/src/index.ts` |
| Dashboard agent | `src/features/dashboard/**` |
| Reports agent | `src/features/reports/**` |
| Orchestrator | everything else (`src/App.tsx`, `src/components/**`, `src/lib/**`, docs) |

Routes (wired by the orchestrator): `/` DashboardPage (Today), `/health` the existing profile `HomePage`, `/reports` ReportsPage (lazy loaded), `/weight` and `/settings` unchanged. Tabs: Today, Meals, Activity, Reports, Settings.

## Decisions

1. All math lives in `@fittrack/shared` (pure, tested). UI only formats and draws.
2. **Logged day** = at least one `meal_entries` row for that IST date. Intake averages, net balance, estimated weight change and "on target" use logged days only; unlogged days are reported as a count ("N of M days logged"), never as 0 kcal.
3. **Calories out** = BMR for that day (weight in effect: latest weight log on or before the day, else the profile weight; Mifflin-St Jeor with age on that day) + active calories. Always labelled **estimated**.
4. **Allowance** for a day = `dailyKcalTarget + addbackPct% of that day's active kcal`. **On target** = logged and `kcalIn <= allowance`.
5. Excluded (hidden duplicate) activities never count. Days after `today` are never included.
6. Data loading uses `fetchRangeData` / `loadReportInputs` from `src/lib/rangeData.ts` (paged, includes HR zones). The dashboard shows server data; entries still queued offline appear after they sync (say so in an offline note).
7. Ranges: Day (one date), Week (7 days ending on the anchor), Month (30 days ending on the anchor), Custom (max 366 days). Previous/next shifts by the range length and never goes past today.
8. 7,700 kcal is about 1 kg; estimated weight change = total net kcal of logged days / 7700.

## Shared API (`packages/shared/src/reports.ts`)

```ts
istDateOfIso(iso: string): string                      // IST calendar date of a UTC ISO instant (UTC+05:30, no DST), pure arithmetic
addDays(date: string, n: number): string               // YYYY-MM-DD arithmetic
eachDate(range: DateRange): string[]                   // inclusive list
presetRange(preset: "day" | "week" | "month", anchor: string): DateRange   // day [a,a], week [a-6,a], month [a-29,a]
shiftRange(range: DateRange, dir: -1 | 1, today: string): DateRange        // moves by its length in days; forward never passes today (returns the range unchanged if range.to >= today)
validateCustomRange(from: string, to: string, today: string, maxDays?: number): string | null   // error text or null (default max 366, no future, from <= to, valid dates)
buildDayRows(inputs: ReportInputs): DayRow[]
summarizeRange(inputs: ReportInputs): RangeSummary
buildInsights(summary: RangeSummary): string[]         // plain-language, at most 8, none for missing data
todaySnapshot(inputs: ReportInputs): TodaySnapshot     // inputs.range is today..today
```

## Dashboard agent: `DashboardPage` (route `/`)

Mobile-first Today screen, from `todaySnapshot` over today's data:
- Calories remaining ring (remaining = target + add-back - consumed; turns to an "over" state with the over amount), with allowance breakdown ("target + exercise add-back").
- Consumed vs target vs burned (BMR + active, estimated), net calories.
- Active time, workout count, average HR (only when HR data exists).
- Always-visible **+ Add Activity** floating button opening `AddActivitySheet` from `src/features/activity`; Strava sync chip (`StravaSyncChip` from `src/features/strava`) when connected; keep the once-per-app-open auto-sync that `HomePage` does today (the same hook call), since `/` moves from `HomePage` to this page.
- Macro progress bars vs targets and a macro split donut (kcal share).
- BMI value, category, colour gauge (reuse `BmiGauge` from `src/features/profile/ui`) and latest weight with a link to `/weight`; a "Details" link to `/health`.
- Meal-by-meal cards (Breakfast, Lunch, Evening Snack, Dinner) with kcal, linking to `/meals`; a "Log a meal" prompt in empty slots.
- States: loading, error with retry, incomplete profile (link to `/onboarding`), offline note, a fresh-day empty state. Refetch when the page regains focus/visibility and when the IST date changes.

## Reports agent: `ReportsPage` (route `/reports`)

- Range selector: Day, Week, Month, Custom (two date inputs with `validateCustomRange` messages), previous/next arrows, the range label in IST.
- Header stats: days logged ("N of M"), average in, average out (estimated), average net, days on target vs over, total active hours.
- Charts (Recharts, lazy-loaded inside the route, accessible): calories in vs out (bars per day), net balance trend (line with a zero reference), calories per meal slot, macro averages vs targets, macro kcal split, weight and BMI trend, activity count by type, source breakdown (Strava vs manual), average and max HR trend, time in HR zones. HR sections appear only when `summary.hr.hasData`, otherwise show "No heart-rate data".
- Highest-calorie foods list, estimated weight change (with the 7,700 kcal note), progress toward target weight, and the insights list from `buildInsights`.
- Every estimated value labelled "estimated"; clear empty state when nothing is logged in the range; states for loading, error with retry, incomplete profile.
- Accessibility: every chart has a text alternative (a visible one-line summary or an expandable data table), colours are colour-blind-safe with legends, dark mode via the existing Tailwind approach. For long ranges (month/custom) thin the x-axis labels.
- Exports (PDF/CSV) and email are Phase 4: do not build them.
