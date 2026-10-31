# Phase 1 Contract

Agents code against this document. Do not change it, `packages/shared/src/types.ts` or `src/lib/database.types.ts`. If something looks wrong, report it back instead of editing.

## File ownership

| Owner | Paths |
|---|---|
| DB agent | `supabase/**` |
| Shared agent | `packages/shared/src/**` except `types.ts`; `packages/shared/package.json` |
| Auth/Profile agent | `src/features/auth/**`, `src/features/profile/**`, `src/features/weight/**` |
| Meals agent | `src/features/meals/**` |
| Activity agent | `src/features/activity/**` |
| Orchestrator | everything else (config, `src/App.tsx`, `src/lib/**`, `src/components/**`, docs, README) |

Feature agents may import from `@/lib/*`, `@/components/*` and `@fittrack/shared`, and must not edit them. Need a shared helper? Put it inside your own feature folder.

## Shared module API (`@fittrack/shared`, implemented by the Shared agent)

All pure functions, no framework imports. Weights in kg, heights in cm, energy in kcal.

```ts
bmi(weightKg: number, heightCm: number): number                       // 1 decimal
bmiCategory(bmi: number, standard: BmiStandard): BmiCategory          // asian: <18.5, <23, <25, else obese; who: <18.5, <25, <30
healthyWeightRange(heightCm: number, standard: BmiStandard): { minKg: number; maxKg: number } // BMI 18.5 .. 22.9 (asian) / 24.9 (who)
ageFromDob(dob: string, now?: Date): number
bmr(input: { sex: Sex; weightKg: number; heightCm: number; ageYears: number }): number
activityFactor(level: ActivityLevel): number                          // 1.2 / 1.375 / 1.55 / 1.725 / 1.9
tdee(bmr: number, level: ActivityLevel): number
calorieTarget(input: { tdee: number; bmr: number; sex: Sex; goal: Goal; pace: Pace }): CalorieTarget
macroTargets(input: { weightKg: number; kcal: number }): MacroTargets // protein 1.4 g/kg, fat 27.5% kcal, carbs remainder
dayAllowance(targetKcal: number, exerciseKcal: number, addbackPct: number): number
metKcal(input: { met: number; weightKg: number; durationMin: number }): number // MET x kg x h, rounded
metForIntensity(t: { met_light: number; met_moderate: number; met_vigorous: number }, i: Intensity): number
defaultMaxHr(ageYears: number): number                                // 220 - age
hrZones(maxHr: number): Array<{ zone: 1|2|3|4|5; minBpm: number; maxBpm: number }>
weeksToTarget(input: { weightKg: number; targetWeightKg: number; pace: Pace }): number
targetDate(weeks: number, from?: Date): Date
kcalToKg(kcal: number): number                                        // kcal / 7700
gramsFor(quantity: number, unit: FoodUnit | "serving", food: { serving_g: number; unit_grams: Record<string, number> }): number
scaleNutrition(per100g: Nutrition, grams: number): Nutrition          // rounded to 1 decimal (kcal to integer)
computeProfileDerived(p: ProfileInput, now?: Date): ProfileDerived
```

Default unit grams when a food has no override: g=1, ml=1, tbsp=15, cup=240, katori=150, plate=250, piece=`serving_g`.

## Conventions for app code

- Supabase client lives in `src/lib/supabase.ts` (orchestrator). Features import `supabase` and `useSession()` from `@/lib/*`.
- Dates for meals and activities: use the IST calendar date (`Asia/Kolkata`). Helpers in `src/lib/time.ts`: `istToday()`, `istDateOf(iso)`, `toUtcIso(istDate, hhmm)`, `formatIst(iso)`.
- Offline: writes go through `enqueue(op)` from `src/lib/outbox.ts`. Rows carry client-generated UUIDs; the outbox upserts by `id`.
- Every screen has loading, error and empty states; Tailwind; dark mode via `dark:` classes; mobile first.
- Validation ranges: duration 1-600 min, HR 40-220, quantity > 0, weight 20-400 kg, height 100-250 cm.
- Estimated calories: when the user gives none, compute with `metKcal` and set `calories_estimated = true`; show an "estimated" tag.
