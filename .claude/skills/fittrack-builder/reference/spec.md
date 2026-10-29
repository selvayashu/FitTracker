# FitTrack Product Spec

Personal health tracker PWA: exercise (Strava or manual), weight, meals, BMI, daily calorie allowance, and detailed calories-in/out reports.

## 1. Authentication and profile
- Supabase Auth: email/password and Google sign-in
- First-login profile: name, age (dob), gender, height (cm or ft/in), current weight (kg), target weight, activity level, goal (lose/maintain/gain), pace (0.25 or 0.5 kg/week)
- Onboarding: "How will you track activity?" -> Connect Strava or Enter manually (changeable in Settings)
- Weight log: update anytime; history in `weight_logs`; recalculate everything on change

### BMI
- kg / m², 1 decimal. Default Asian cut-offs (<18.5 Underweight, 18.5-22.9 Normal, 23.0-24.9 Overweight, >=25.0 Obese), switchable to WHO
- Healthy weight range for height (BMI 18.5-22.9)
- Colour-coded gauge; BMI trend chart from weight history

### Calorie allowance
- BMR Mifflin-St Jeor; TDEE = BMR x activity (1.2 / 1.375 / 1.55 / 1.725 / 1.9)
- Goal: Lose = TDEE - 275 or 550; Maintain = TDEE; Gain = TDEE + 275 or 550
- Floor: never below 1200 (F), 1500 (M) or BMR; warn if the goal would go under
- Exercise add-back: configurable share (default 50%) of that day's exercise kcal
- Macros: protein 1.2-1.6 g/kg, fat 25-30% kcal, carbs remainder
- Estimated date to reach target weight at the chosen pace
- Store bmi, bmr, tdee, daily_kcal_target, macro targets in `profiles`; recalc when weight, age, activity level or goal changes

## 2. Activity tracking
Single `activities` table, `source` in ('strava','manual').

### 2a. Manual entry
- Type from `activity_types`: Walking, Brisk walking, Running, Cycling, Swimming, Yoga, Gym/Strength training, HIIT, Dance, Badminton, Cricket, Football, Tennis, Skipping, Stair climbing, Household chores, Gardening, Other (custom name)
- Required: date, start time, duration (hh:mm)
- Intensity Light/Moderate/Vigorous selects the MET value
- Optional: distance km, steps, avg HR, max HR, calories, notes
- No calories entered -> kcal = MET x kg x hours, flagged "estimated" (Compendium of Physical Activities METs in `activity_types`)
- Quick-add: repeat a recent activity; saved templates (e.g. "Morning walk 45 min")
- Edit/delete manual activities; Strava activities read-only except notes
- Works offline, syncs when online

### 2b. Strava (optional, OAuth 2.0)
- "Connect Strava" in onboarding and Settings; scopes `read,activity:read_all`
- Callback handled by a Cloudflare Worker; client secret is a Worker secret only
- Store access_token, refresh_token, expires_at in an RLS table; auto-refresh before expiry
- Sync: initial 90 days; webhook for new/updated; manual "Sync now"
- Per activity, call the detailed endpoint; store type, name, start, moving/elapsed time, distance, calories, avg/max HR, elevation, suffer score
- No calories from Strava -> MET estimate, flagged "estimated"
- HR stream (`/activities/{id}/streams?keys=heartrate,time`) -> time in zones 1-5 from max HR (220 - age, editable)
- Duplicate check: same type, start within +/-30 min of a manual one -> flag, user keeps one
- Respect rate limits: queue, back off on 429
- "Disconnect Strava": deauthorize and delete tokens; synced activities stay unless the user chooses to delete them

## 3. Meal logging
- Slots: Breakfast, Lunch, Evening Snack, Dinner
- Search foods, choose quantity and unit (g, ml, piece, katori, cup, plate, tbsp)
- `foods` seeded with ~300 common Indian foods (idli, dosa, chapati, rice, sambar, dal, poha, upma, biryani, curd, tea, coffee...) with kcal, protein, carbs, fat, fibre per 100 g and a standard serving
- Fallback search: Open Food Facts API for packaged foods
- Custom foods; favourite/recurring meals
- Live kcal/macro totals per meal and per day
- Copy yesterday's meal to today
- Offline entry, sync when online

## 4. Dashboard (Today)
- Calories remaining = target + exercise add-back - consumed
- Consumed vs target vs burned (BMR + active), net calories
- Active time, workout count, avg HR (when available)
- Always-visible "+ Add Activity"; Strava sync status badge if connected
- Macro progress vs targets; macro split donut
- Current BMI + category, latest weight
- Meal-by-meal summary cards

## 5. Reports
- Daily / weekly / monthly / custom range
- Calories in vs out (bars), net balance trend (line)
- Total active hours, count by type, distance, source breakdown (Strava vs manual)
- Avg/max HR trend and HR zone time, only when HR data exists, else "No heart-rate data"
- Macro averages vs targets, kcal per meal slot, highest-calorie foods
- Days on target vs over
- Weight and BMI trend, estimated change (7,700 kcal ~ 1 kg), progress to target
- Plain-language insights ("Dinner was 42% of your intake this week", "You were active 4 of 7 days")
- Label estimated calories
- Export PDF and CSV
- Optional weekly summary email (Supabase cron + Resend)

## 6. Schema (RLS on every table, `user_id = auth.uid()`)
- `profiles`: height, gender, dob, activity_level, goal, pace, target_weight, bmi, bmr, tdee, daily_kcal_target, protein/carb/fat targets, max_hr, bmi_standard, exercise_addback_pct, activity_tracking_mode
- `weight_logs`: user_id, date, weight_kg, bmi
- `strava_connections`
- `activity_types`: id, name, met_light, met_moderate, met_vigorous, has_distance (seeded, read-only)
- `activities`: user_id, source, strava_id (nullable, unique), activity_type_id, custom_name, start_time, duration_min, distance_km, steps, intensity, avg_hr, max_hr, calories, calories_estimated, notes
- `activity_templates`: user_id, name, activity_type_id, duration_min, intensity
- `activity_hr_zones`
- `foods`, `custom_foods`
- `meal_entries`: user_id, date, meal_type, food_id, quantity, unit, kcal, protein, carbs, fat
- `favourite_meals`
- `daily_summaries` (table or materialized view refreshed on change)

## 7. Non-functional
- Mobile-first, responsive, dark mode
- Display IST (Asia/Kolkata); store UTC
- Validation (duration 1-600 min, HR 40-220); loading, error, empty states
- Fully usable without Strava
- `.env.example`: SUPABASE_URL, SUPABASE_ANON_KEY, STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_WEBHOOK_VERIFY_TOKEN, RESEND_API_KEY
- Disclaimer: BMI and calorie figures are estimates, not medical advice

## Deliverables
- Project folder structure
- Supabase SQL migrations (tables, RLS, indexes, seeds for foods and activity types with MET values)
- Cloudflare Worker: Strava OAuth callback, token refresh, webhook, sync
- Shared TS module for BMI/BMR/TDEE/target/macro/MET calcs with unit tests
- React frontend with all screens
- PWA config (manifest, icons, service worker)
- README: Strava API app (callback domain), Supabase setup, Cloudflare Pages deploy from GitHub, secrets, Strava webhook registration

## Phases (stop after each for user testing)
1. Auth, profile, BMI and calorie target, weight log, meal logging, manual activity entry
2. Strava connect, sync, duplicate handling
3. Dashboard and reports
4. PWA polish, export, email
