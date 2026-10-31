# Phase 1 Test Checklist

Covers: auth, profile, BMI and calorie target, weight log, meal logging, manual activity entry.
Everything below needs a real Supabase project. Nothing in Phase 1 has been run against one yet, so **record every failure** (screen, steps, what you saw) and send it back.

Mark each item: [x] pass, [!] fail (add a note), [-] skipped.

## A. Setup (one time)

- [ ] Create a Supabase project; copy the Project URL and anon key.
- [ ] Apply `supabase/migrations/0001` to `0005` in order (SQL Editor or `npx supabase db push`). No errors.
- [ ] Table Editor shows 10 tables; `activity_types` has 18 rows, `foods` has about 349.
- [ ] Authentication, URL Configuration: add `http://localhost:5173` and `http://localhost:5173/reset-password` as redirect URLs.
- [ ] For quick testing, turn off "Confirm email" (turn it back on afterwards).
- [ ] `cp .env.example .env.local`, fill `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- [ ] `npm install`, then `npm run dev` and open http://localhost:5173.
- [ ] Automated checks still green: `npm run typecheck`, `npm run lint`, `npm test` (126 tests), `npm run build`.
- [ ] `cd supabase/tests && npm install && npm test` shows 85 passed.

## B. Authentication

- [ ] Without `.env.local` values the login page shows the "not connected to a backend" banner and disables the buttons.
- [ ] Sign up with an invalid email, then a 7-character password: each shows a clear message.
- [ ] Sign up with a valid email and an 8+ character password: you are signed in and sent to onboarding. A `profiles` row exists for you (Table Editor).
- [ ] Sign out (Settings), then sign in with a wrong password: "Email or password is incorrect."
- [ ] Sign in with the right password: you land on Home (or onboarding if not finished).
- [ ] Reload the browser: you stay signed in.
- [ ] Forgot password: request a link, open it, you reach `/reset-password`; mismatched passwords are rejected; a valid new password signs you in; the new password works after sign-out.
- [ ] Open `/reset-password` while signed out with no link: "invalid or has expired" message.
- [ ] Optional: Google sign-in (needs the Google provider configured). Works and creates a profile.
- [ ] While signed out, visiting `/meals` redirects to `/login`. While signed in, `/login` redirects to Home.

## C. Onboarding, BMI and calorie target

Use this worked example. Choose a date of birth that makes you **32 years old today**.
Female, height 162 cm, weight 68 kg, target 60 kg, activity **Light**, goal **Lose**.

- [ ] Onboarding validates: height 99 and 251 cm rejected; weight 19 and 401 kg rejected; age under 12 or over 100 rejected.
- [ ] Height can be entered as ft/in and converts to cm (5 ft 4 in is about 162.6 cm).
- [ ] Pace 0.5 kg/week: live preview shows **BMR 1372**, **TDEE 1886**, and a **safety-floor warning**. The target is held at **1372 kcal**, not 1336.
- [ ] Switch pace to 0.25: target becomes **1611 kcal**, and the warning disappears.
- [ ] BMI shows **25.9**. Category is **Obese** under the Asian standard.
- [ ] In Settings switch to WHO cut-offs: category becomes **Overweight**. Switch back.
- [ ] Healthy weight range (Asian) is about **48.5 to 60.1 kg**.
- [ ] Macro targets at 1611 kcal: protein **95 g**, fat **49 g**, carbs about **197-198 g**.
- [ ] Estimated date to reach 60 kg at 0.25 kg/week is about **32 weeks** from today (16 weeks at 0.5).
- [ ] Male check: same inputs but male gives BMR **1538** (the formula uses +5 instead of -161, so 166 kcal higher) and TDEE **2114**. At 0.5 kg/week the target is **1564**, with no floor warning because it is above the male floor (the higher of BMR and 1500).
- [ ] Goal Maintain: target equals TDEE (1886). Goal Gain at 0.5: 2436.
- [ ] "How will you track activity?": Strava option is disabled ("Coming in Phase 2"); choose manual.
- [ ] Finishing onboarding creates a `weight_logs` row for today and sets `onboarded = true` in `profiles`.
- [ ] Home shows BMI gauge, category colour, target, macros, healthy range, ETA, and the disclaimer.

## D. Settings

- [ ] Change activity level to Moderate: TDEE and target update immediately; message "Targets recalculated".
- [ ] Change the exercise add-back % (try 0, 50, 100; 101 is rejected).
- [ ] Clear the max heart rate field and save: it returns to 220 minus your age (188). Enter 175: it is kept.
- [ ] Change weight in Settings: Home updates, **and** the Weight page shows a log for today with the same value.
- [ ] After saving, the page does not flash back to a spinner and your message stays visible.

## E. Weight log

- [ ] Log 67.5 kg for today: Home weight and BMI update; chart shows the point.
- [ ] Log a past date (for example 7 days ago): history shows it; Home weight does **not** change (it is not the latest).
- [ ] Logging the same date again replaces that entry (one row per day).
- [ ] Future date, 19 kg and 401 kg are rejected.
- [ ] Delete the latest entry: Home weight reverts to the new latest entry.
- [ ] The BMI trend chart renders in light and dark mode.
- [ ] Progress bar to target weight looks right (starting weight to target).

## F. Meals

- [ ] Four slots are shown: Breakfast, Lunch, Evening Snack, Dinner. Empty slots say so.
- [ ] Search "idli": results appear. Add **1 serving** (2 idli, 80 g): about **78 kcal**. Add **1 piece**: about **39 kcal** (40 g).
- [ ] Chapati, 2 pieces: about **193 kcal** (241 kcal per 100 g, 40 g each).
- [ ] Units g, ml, piece, katori, cup, plate and tbsp all give a sensible live preview.
- [ ] Quantity 0 and negative are rejected.
- [ ] Slot totals and the day total (kcal, protein, carbs, fat) update immediately and match the sum of items.
- [ ] Edit an entry's quantity: totals change. Remove an entry: totals drop.
- [ ] Add a custom food (name, per-100 g values, serving). It appears in search and can be logged. kcal above 900 per 100 g and a missing name are rejected.
- [ ] Search a packaged food not in the list (for example a biscuit brand): the Open Food Facts option appears and results can be logged. Check the browser console for CORS errors and report them.
- [ ] Save a slot as a favourite, then add that favourite to another slot.
- [ ] Day switcher: go to yesterday, add something, return to today. "Copy yesterday" copies it with the right nutrition; on an empty yesterday it says so.
- [ ] Rows in Supabase `meal_entries` have the IST calendar `date`, the snapshot values, and `grams`.

## G. Manual activity

Worked checks use weight 68 kg and the seeded METs.

- [ ] Add Walking, Moderate, 40 min with no calories entered: shows **159 kcal, estimated** (3.5 x 68 x 0.667).
- [ ] Add Running, Vigorous, 30 min: **391 kcal, estimated**. Light intensity gives a lower value.
- [ ] Enter calories yourself (for example 300): saved as entered with **no** "estimated" tag.
- [ ] Choose "Other": a custom name becomes required; the saved row has `custom_name`.
- [ ] Validation: duration 00:00 and 10:01 rejected, 00:01 and 10:00 accepted; HR 39 and 221 rejected; average HR above max HR rejected; a future date rejected; **today with a later time than now is rejected**.
- [ ] Start time is stored in UTC. Check one row in Supabase (a 06:30 IST activity shows `01:00:00+00`).
- [ ] Edit an activity (change duration): the list and kcal update, no duplicate row is created.
- [ ] Delete an activity. "Repeat" creates a copy starting now.
- [ ] Save a template, then start a new activity from the template chip. Delete a template.
- [ ] The day summary shows total active minutes and kcal with a note about estimates.
- [ ] Check `daily_summaries` in Supabase: kcal_in, active minutes and workouts match what you entered.
- [ ] If your profile has no weight yet, estimation asks you to complete your profile instead of failing.

## H. Offline

Use browser dev tools, Network, "Offline" (or turn off Wi-Fi).

- [ ] The yellow offline banner appears. Add a meal and an activity: both appear immediately.
- [ ] Reload while offline: the cached day and activities still render, with an offline note, and the app does not crash.
- [ ] Add two more meals quickly while offline, then go back online: the banner says items are syncing, then clears. All rows appear in Supabase **exactly once** (no duplicates).
- [ ] Add a meal, then go offline and delete it, then go online: it ends up deleted.
- [ ] Edit an activity offline, go online: the edit is saved (not reverted by the server copy).
- [ ] Weight logging and profile saves need a connection. Check they show a clear error offline (known limitation).
- [ ] Sign out, sign in as a **second account**: you see none of the first account's meals or activities.

## I. Security (Supabase)

- [ ] With two accounts, the second cannot see the first's rows in the app.
- [ ] In the SQL Editor, `select * from meal_entries` as the `anon` role returns nothing or errors.
- [ ] The browser bundle contains no service-role key (search the built `dist` for "service_role").

## J. UI and accessibility

- [ ] Layout is usable at 360 px width; bottom tab bar never covers content or the "+ Add Activity" button.
- [ ] Dark mode (OS setting) looks right on every screen, including the gauge and chart.
- [ ] Every form field has a visible label and errors are readable.
- [ ] Every screen shows loading, error and empty states; the disclaimer appears.
- [ ] Reload on a deep link such as `/meals` works.

## Known limitations (not bugs for Phase 1)

- Strava is not available until Phase 2; the option is disabled.
- Weight and profile edits do not work offline.
- A queued delete can briefly reappear after a reload until the queue flushes.
- Only the pure logic has automated tests; the screens and the offline queue have not been tested automatically.
- The production bundle is large (Recharts); code-splitting comes in Phase 4.

## Reporting back

For each failure send: the section and item, steps, what you expected, what you saw, and any red text in the browser console. When you are happy with Phase 1, say so and I will start Phase 2 (Strava).
