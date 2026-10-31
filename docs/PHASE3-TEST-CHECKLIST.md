# Phase 3 Test Checklist (Dashboard and Reports)

> **Draft written from `docs/CONTRACT-PHASE3.md` before the screens were built.** Item wording and numbers will be re-checked against the finished screens before you test; treat anything that does not match the app as a checklist bug and tell me.

Covers: the Today dashboard and the Reports screen (ranges, charts, metrics, insights).
No new migrations, secrets or Cloudflare settings are needed. Phase 1 must work (and Phase 2 if you use Strava).
**Record every failure** (screen, steps, expected vs actual, browser console).

Mark each item: [x] pass, [!] fail (add a note), [-] skipped.

## A. Test data (do this first)

Use the Phase 1 worked profile: female, 162 cm, 68 kg, target 60 kg, light activity, lose at **0.25 kg/week** (target **1611 kcal**, BMR 1372, exercise add-back 50%, protein target 95 g).

- [ ] Today: log breakfast, lunch, a snack and dinner with a few foods each (note the total kcal the Meals page shows for the day; call it **X**).
- [ ] Today: add a manual **Walking, Moderate, 40 min** activity (159 kcal, estimated) and, if you use Strava, sync at least one activity with heart-rate data.
- [ ] Yesterday and the 5 days before it: log meals on 4 of the 6 days and leave 2 days empty on purpose. Add activities on 3 of them. (Use the date switcher on the Meals page and the date field on the activity form.)
- [ ] Log at least 3 weight entries on different dates (Weight page).

## B. Navigation

- [ ] The bottom bar shows **Today, Meals, Activity, Reports, Settings**.
- [ ] `/` opens the Today dashboard; the old BMI/target detail page is reachable from Today ("Details") and the weight page from the BMI card.
- [ ] Reload on `/reports` and `/health` works (deep links).
- [ ] Opening the app while connected to Strava still runs one automatic sync (once per app open, at most every 15 minutes).

## C. Today dashboard

- [ ] **Calories remaining** ring: remaining = target + 50% of today's active kcal - consumed. With target 1611, a 159 kcal walk and consumed **X**, remaining is about `1611 + 80 - X` (the breakdown line shows target + add-back).
- [ ] When consumed exceeds the allowance the ring switches to an "over" state and shows how much over.
- [ ] **Consumed / target / burned**: burned is about BMR 1372 + 159 = **1531** and is labelled estimated; **net** = consumed - burned.
- [ ] Active time shows 0h 40m and workouts 1 for the walk. Average heart rate appears **only** when an activity with HR exists; otherwise it is hidden or "no heart-rate data".
- [ ] **+ Add Activity** is visible without scrolling and opens the add sheet; saving updates the dashboard right away (or after the refetch) without a manual reload.
- [ ] A Strava sync chip shows (last sync / syncing / error) only when connected. In manual mode there is no Strava UI.
- [ ] **Macros**: the bars show protein, carbs and fat against targets (95 g protein for the example); the donut slices match the kcal share (protein and carbs 4 kcal/g, fat 9).
- [ ] **BMI** card: value, category and gauge match the Settings/Health page; latest weight matches the Weight page; the link opens `/weight`.
- [ ] **Meal cards**: each of the four slots shows its kcal; they add up to the consumed figure. Empty slots show a prompt to log a meal and link to `/meals`.
- [ ] Add a meal on the Meals page, return to Today: the numbers update (also after switching tabs or the app regaining focus).
- [ ] Leave the app open past IST midnight (or change the device date): the dashboard moves to the new day.
- [ ] Incomplete profile (use a new account before onboarding is finished): a "Complete your profile" state, no crash.
- [ ] Error state: block the network for the Supabase domain (DevTools, block request) and reload: a readable error with **Try again**.
- [ ] Offline: with cached data a note explains that entries queued offline appear after they sync.

## D. Reports: ranges

- [ ] Default view is **Week** (7 days ending today). Day, Week, Month and Custom all work.
- [ ] The label shows the date range in IST (for example "5 Mar - 11 Mar"). Previous/next arrows move by the range length; **next** is disabled or does nothing when the range already ends today.
- [ ] Custom range: a start after the end, a future end date and a range longer than 366 days each show a clear message and do not load data. A valid range loads.
- [ ] Switching range type keeps the anchor date sensible and does not flash wrong data.

## E. Reports: numbers (cross-check against what you entered)

Pick the Week range that contains the test data from section A.

- [ ] Header shows **"N of M days logged"** and the count matches the days you logged (for example 5 of 7 with 2 empty days).
- [ ] **Average kcal in** equals the total intake on logged days divided by the number of **logged** days (not by 7). Verify with a calculator against the Meals page totals.
- [ ] Empty (unlogged) days are not counted as 0 kcal and are not counted as "on target".
- [ ] **Days on target / over**: a day counts as on target when intake <= target + 50% of that day's active kcal. Make one test day exactly at the allowance (on target) and one 1 kcal above (over).
- [ ] **Average out** is labelled estimated; it equals BMR (using the weight in effect that day) + active kcal, averaged over logged days. A weight entry in the middle of the range changes BMR from that date onward only.
- [ ] **Net balance** per day and the average equal intake minus estimated out.
- [ ] **Estimated weight change** = total net of logged days / 7,700, shown with the note that 7,700 kcal is about 1 kg. Negative means loss.
- [ ] **Active time** total, active days and workout count match the Activity page; hidden (excluded) Strava duplicates are **not** counted.
- [ ] **By type** counts match the activities you logged; a custom "Other" activity shows its own name.
- [ ] **Source breakdown**: Strava vs manual counts and minutes match the badges on the Activity list.
- [ ] **Distance** total matches the sum of the distances you entered or synced.
- [ ] **Estimated calories** are flagged: when most active calories come from MET estimates, the report says so.
- [ ] **Macro averages** vs targets show percent of target; the kcal split sums to 100%.
- [ ] **Calories per meal slot** shows average kcal and percentage per slot; percentages sum to about 100%.
- [ ] **Highest-calorie foods** lists up to 5 foods by total kcal in the range; the top one matches what you logged.
- [ ] **Weight and BMI trend** shows only weight entries inside the range; **progress toward target** uses your first weight ever and your latest weight (0-100%, 100% for a maintain goal).
- [ ] Day range for today matches the Today dashboard exactly (consumed, burned, net).

## F. Reports: heart rate

- [ ] With no heart-rate data in the range: the section shows **"No heart-rate data"** and no empty charts.
- [ ] With Strava HR data: average and max HR trend appear; the zone chart shows minutes in zones 1-5 and the total roughly matches the sum of the activities' zone bars on the Activity page.

## G. Charts and accessibility

- [ ] Calories in vs out (bars), net balance (line with a zero reference), meal-slot split, macro chart, weight/BMI trend, activity by type and source all render without console errors, in light and dark mode.
- [ ] Hover/tap shows values; legends are present and the colours are distinguishable (try a colour-blind simulation or grayscale).
- [ ] Every chart has a text equivalent (one-line summary or a data table) readable by a screen reader.
- [ ] On a 360 px wide screen charts fit without horizontal page scroll; the x-axis labels are thinned on Month and Custom ranges.
- [ ] A Month or 100-day custom range renders quickly (a few seconds at most) and the UI stays responsive.
- [ ] The Reports code is loaded on demand: in DevTools, Network, the Recharts chunk loads when you open `/reports`, not on the login page.

## H. Insights

- [ ] Insights read in plain language, for example "Dinner was 42% of your intake this week", "You were active 4 of 7 days", "You stayed within your allowance on 5 of 6 logged days".
- [ ] Wording is right for 1 day vs several days (singular/plural) and never shows NaN, Infinity or "0 of 0".
- [ ] With no data in the range there are no insights, just the empty state.
- [ ] Estimates are described as estimates (weight change, calories out).

## I. Edge cases

- [ ] A range with no meals and no activities: friendly empty state, no charts of zeros, no errors.
- [ ] A day with activities but no meals: appears in active time and activity charts but not in intake averages.
- [ ] A range where you changed profile targets (for example activity level): the report uses the **current** stored target for all days (known limitation, see below).
- [ ] Very large data (for example 1,000+ meal entries across a custom range) still loads completely (the loader pages through Supabase's 1,000 row limit). Compare the meal count with Supabase's row count if you can.
- [ ] Meals logged just before midnight IST and activities started late evening fall on the correct IST day, not the next UTC day.
- [ ] Sign in as a second account: no data from the first account appears.

## J. Regression

- [ ] Meals, Activity (including Strava sync, duplicates and HR zones), Weight and Settings all behave as before.
- [ ] Manual-mode users still make no `/api/strava` calls.
- [ ] `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` are green.

## Known limitations

- Historical days use today's stored calorie target and add-back percentage; only BMR follows your weight history.
- Calories out are estimates (BMR formula plus MET or Strava calories), not measurements.
- Entries queued while offline appear on Today and Reports only after they sync.
- PDF/CSV export and the weekly email arrive in Phase 4.
- Real Supabase behaviour has not been exercised by automated tests; calculations are covered by unit tests only.

## Reporting back

For each failure send: section and item, steps, expected and actual numbers, a screenshot if helpful, and any red browser-console text. When you are happy with Phase 3, say so and I will start Phase 4 (PWA polish, export and email).
