import { Link } from "react-router-dom";
import { healthyWeightRange, targetDate, weeksToTarget } from "@fittrack/shared";
import { useProfile } from "@/lib/profile";
import { StravaSyncChip, useStrava } from "@/features/strava";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { Banner, BmiGauge, CATEGORY_COLOR, CATEGORY_LABEL, cardCls, fmtDate } from "./ui";

export function HomePage() {
  const { profile, derived, loading, error, refresh } = useProfile();
  const strava = useStrava({ enabled: profile?.activity_tracking_mode === "strava", autoSync: true });

  if (loading) return <Spinner label="Loading your profile" />;
  if (error) return <ErrorState message={`Could not load your profile: ${error}`} onRetry={() => void refresh()} />;
  if (!profile || !derived || !profile.height_cm || !profile.weight_kg || !profile.target_weight_kg || !profile.goal || !profile.pace) {
    return (
      <main className="mx-auto max-w-md p-4">
        <EmptyState
          title="Complete your profile"
          hint="Add your height, weight and goal to see your BMI and daily calorie target."
          action={<Link to="/onboarding" className="inline-block rounded-lg bg-teal-600 px-4 py-2 font-medium text-white">Complete your profile</Link>}
        />
        <Disclaimer />
      </main>
    );
  }

  const range = healthyWeightRange(profile.height_cm, profile.bmi_standard);
  const towardTarget =
    (profile.goal === "lose" && profile.target_weight_kg < profile.weight_kg) ||
    (profile.goal === "gain" && profile.target_weight_kg > profile.weight_kg);
  const weeks = towardTarget ? weeksToTarget({ weightKg: profile.weight_kg, targetWeightKg: profile.target_weight_kg, pace: profile.pace }) : 0;
  const eta = towardTarget ? targetDate(weeks) : null;
  const kcal = (n: number) => n.toLocaleString("en-IN");

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <h1 className="text-xl font-semibold">{profile.name ? `Hi, ${profile.name}` : "Your summary"}</h1>
      <StravaSyncChip strava={strava} />

      <section className={cardCls} aria-label="BMI">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">BMI</h2>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: CATEGORY_COLOR[derived.bmiCategory] }}>
            {CATEGORY_LABEL[derived.bmiCategory]}
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between">
          <p><span className="text-3xl font-bold">{derived.bmi}</span> <span className="text-sm text-slate-500 dark:text-slate-400">kg/m&sup2;</span></p>
          <p className="text-right text-sm text-slate-500 dark:text-slate-400">Weight {profile.weight_kg} kg<br />Target {profile.target_weight_kg} kg</p>
        </div>
        <BmiGauge bmi={derived.bmi} standard={profile.bmi_standard} />
        <p className="mt-3 text-sm">Healthy range for your height: <b>{range.minKg.toFixed(1)} - {range.maxKg.toFixed(1)} kg</b>{" "}
          <span className="text-slate-500 dark:text-slate-400">({profile.bmi_standard === "asian" ? "Asian" : "WHO"} standard)</span></p>
        <Link to="/weight" className="mt-3 inline-block text-sm font-medium text-teal-700 underline dark:text-teal-400">Log weight and see trend</Link>
      </section>

      <section className={cardCls} aria-label="Daily target">
        <h2 className="font-semibold">Daily calorie target</h2>
        <p className="mt-1"><span className="text-3xl font-bold">{kcal(derived.dailyKcalTarget)}</span> <span className="text-sm text-slate-500 dark:text-slate-400">kcal / day</span></p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Maintenance (TDEE) {kcal(derived.tdee)} kcal, resting (BMR) {kcal(derived.bmr)} kcal</p>
        {derived.floorApplied && (
          <div className="mt-3"><Banner kind="warn">Your chosen pace would fall below the safe minimum, so your target is held at {kcal(derived.dailyKcalTarget)} kcal. Progress will be slower than the pace you picked.</Banner></div>
        )}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          {[
            ["Protein", derived.macros.proteinG],
            ["Carbs", derived.macros.carbsG],
            ["Fat", derived.macros.fatG],
          ].map(([label, g]) => (
            <div key={label} className="rounded-xl bg-slate-100 p-2 dark:bg-slate-900">
              <p className="text-lg font-bold">{g} g</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={cardCls} aria-label="Goal estimate">
        <h2 className="font-semibold">Estimated date to reach target</h2>
        {eta ? (
          <p className="mt-1 text-sm"><b>{fmtDate(eta)}</b> <span className="text-slate-500 dark:text-slate-400">(about {Math.ceil(weeks)} weeks at {profile.pace} kg per week)</span></p>
        ) : (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {profile.goal === "maintain" ? "You are maintaining your weight." : "Your target does not match your goal. Update it in Settings."}
          </p>
        )}
      </section>
      <Disclaimer />
    </main>
  );
}
