import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { MealType, TodaySnapshot } from "@fittrack/shared";
import { useProfile } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { formatIstDate, istToday } from "@/lib/time";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { Disclaimer } from "@/components/Disclaimer";
import { AddActivitySheet } from "@/features/activity";
import { StravaSyncChip, useStrava } from "@/features/strava";
import { BmiGauge, CATEGORY_COLOR, CATEGORY_LABEL, cardCls } from "@/features/profile/ui";
import { activeTimeLabel, donutSlices, isStale, percent, ringGeometry, ringLabel } from "./present";
import { useToday } from "./useToday";

const kcal = (n: number): string => (Number.isFinite(n) ? Math.round(n) : 0).toLocaleString("en-IN");
const muted = "text-slate-500 dark:text-slate-400";

const SLOTS: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "snack", label: "Evening Snack" },
  { key: "dinner", label: "Dinner" },
];

const MACRO_COLOR = { protein: "#0d9488", carbs: "#f59e0b", fat: "#8b5cf6" } as const;

function Ring({ s }: { s: TodaySnapshot }) {
  const g = ringGeometry(s.consumedKcal, s.allowanceKcal);
  const l = ringLabel(s.remainingKcal, s.over);
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 120 120" role="img" aria-label={l.aria} className="h-full w-full -rotate-90">
          <circle cx="60" cy="60" r={g.radius} fill="none" strokeWidth="10" className="stroke-slate-200 dark:stroke-slate-700" />
          <circle
            cx="60" cy="60" r={g.radius} fill="none" strokeWidth="10" strokeLinecap="round"
            strokeDasharray={g.dashArray} strokeDashoffset={g.dashOffset}
            className={l.over ? "stroke-red-600 dark:stroke-red-400" : "stroke-teal-600 dark:stroke-teal-400"}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
          <span className={`text-3xl font-bold ${l.over ? "text-red-600 dark:text-red-400" : ""}`}>{l.big}</span>
          <span className={`text-xs ${muted}`}>{l.caption}</span>
        </div>
      </div>
      <p className={`mt-2 text-center text-xs ${muted}`}>
        Allowance {kcal(s.allowanceKcal)} = target {kcal(s.targetKcal)} + exercise add-back {kcal(s.addbackKcal)}
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-100 p-2 text-center dark:bg-slate-900">
      <p className="truncate text-lg font-bold">{value}</p>
      <p className={`text-xs ${muted}`}>{label}</p>
      {hint && <p className={`text-[10px] ${muted}`}>{hint}</p>}
    </div>
  );
}

function MacroBar({ label, g, target, color }: { label: string; g: number; target: number; color: string }) {
  const pct = percent(g, target);
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className={muted}>{Math.round(g)} / {Math.round(target)} g</span>
      </div>
      <div
        role="progressbar" aria-label={`${label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-valuetext={`${Math.round(g)} of ${Math.round(target)} grams`}
        className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function Donut({ m }: { m: TodaySnapshot["macros"] }) {
  const slices = donutSlices(m);
  if (slices.length === 0) return <p className={`text-sm ${muted}`}>No macros logged yet.</p>;
  const summary = slices.map((s) => `${s.label} ${Math.round(s.share * 100)} percent`).join(", ");
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" role="img" aria-label={`Share of calories from macros: ${summary}`} className="h-24 w-24 shrink-0 -rotate-90">
        {slices.map((s) => (
          <circle
            key={s.key} cx="50" cy="50" r="40" fill="none" strokeWidth="14" stroke={MACRO_COLOR[s.key]}
            strokeDasharray={`${s.dash} ${s.gap}`} strokeDashoffset={s.offset}
          />
        ))}
      </svg>
      <ul className="space-y-1 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: MACRO_COLOR[s.key] }} aria-hidden="true" />
            {s.label} <span className={muted}>{Math.round(s.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useSession();
  const { profile, derived, loading: profLoading, error: profError, refresh } = useProfile();
  const strava = useStrava({ enabled: profile?.activity_tracking_mode === "strava", autoSync: true });
  const { data, loading, error, stale, incomplete, reload } = useToday(user?.id ?? null, profile, !profLoading && !profError);
  const [adding, setAdding] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  // A finished Strava sync may have added activities.
  const syncRevision = strava.syncRevision;
  useEffect(() => { if (syncRevision > 0) reload(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncRevision]);

  const closeAdd = () => { setAdding(false); reload(); };

  if (profLoading) return <Spinner label="Loading your profile" />;
  if (profError) return <ErrorState message={`Could not load your profile: ${profError}`} onRetry={() => void refresh()} />;
  if (incomplete || !profile || !derived) {
    return (
      <div className="mx-auto max-w-md p-4">
        <EmptyState
          title="Complete your profile"
          hint="Add your height, weight and goal to see your daily calories."
          action={<Link to="/onboarding" className="inline-block rounded-lg bg-teal-600 px-4 py-2 font-medium text-white">Complete your profile</Link>}
        />
        <Disclaimer />
      </div>
    );
  }

  const s = data?.snapshot ?? null;
  const today = istToday();
  const wrongDay = s ? isStale(s.date, today) : false;
  const empty = s ? s.consumedKcal === 0 && s.workouts === 0 : false;
  const weight = data?.latestWeightKg ?? profile.weight_kg;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-28">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="min-w-0 truncate text-xl font-semibold">{profile.name ? `Hi, ${profile.name}` : "Today"}</h1>
        <p className={`shrink-0 text-sm ${muted}`}>{formatIstDate(today)}</p>
      </header>
      <StravaSyncChip strava={strava} />

      {(!online || stale || wrongDay) && s && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {wrongDay ? `Showing ${formatIstDate(s.date)}. ` : "Showing your last saved numbers. "}
          Entries you saved while offline appear here after they sync.
        </p>
      )}

      {!s && loading && <Spinner label="Loading today" />}
      {!s && !loading && error && <ErrorState message={`Could not load today: ${error}`} onRetry={reload} />}

      {s && (
        <>
          <section className={cardCls} aria-label="Calories remaining">
            <h2 className="mb-3 font-semibold">Calories remaining</h2>
            <Ring s={s} />
            {empty && (
              <p className={`mt-3 text-center text-sm ${muted}`}>A fresh day. <Link to="/meals" className="font-medium text-teal-700 underline dark:text-teal-400">Log your first meal</Link></p>
            )}
          </section>

          <section className={cardCls} aria-label="Energy balance">
            <h2 className="mb-3 font-semibold">Energy balance</h2>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Consumed" value={kcal(s.consumedKcal)} hint="kcal" />
              <Stat label="Target" value={kcal(s.targetKcal)} hint="kcal" />
              <Stat label="Burned (estimated)" value={kcal(s.burnedKcal)} hint="kcal" />
            </div>
            <p className={`mt-2 text-xs ${muted}`}>
              Burned (estimated) = resting {kcal(s.bmr)} + active {kcal(s.activeKcal)} kcal.
            </p>
            <p className="mt-2 text-sm">
              Net <b>{s.netKcal > 0 ? "+" : ""}{kcal(s.netKcal)} kcal</b> <span className={muted}>(consumed minus burned, estimated)</span>
            </p>
          </section>

          <section className={cardCls} aria-label="Activity today">
            <h2 className="mb-3 font-semibold">Activity</h2>
            <div className={`grid gap-2 ${s.avgHr != null ? "grid-cols-3" : "grid-cols-2"}`}>
              <Stat label="Active time" value={activeTimeLabel(s.activeMinutes)} />
              <Stat label="Workouts" value={s.workouts} />
              {s.avgHr != null && <Stat label="Avg heart rate" value={Math.round(s.avgHr)} hint="bpm" />}
            </div>
          </section>

          <section className={cardCls} aria-label="Macros">
            <h2 className="mb-3 font-semibold">Macros</h2>
            <div className="space-y-3">
              <MacroBar label="Protein" g={s.macros.proteinG} target={s.macroTargets.proteinG} color={MACRO_COLOR.protein} />
              <MacroBar label="Carbs" g={s.macros.carbsG} target={s.macroTargets.carbsG} color={MACRO_COLOR.carbs} />
              <MacroBar label="Fat" g={s.macros.fatG} target={s.macroTargets.fatG} color={MACRO_COLOR.fat} />
            </div>
            <h3 className="mb-2 mt-4 text-sm font-medium">Calories by macro</h3>
            <Donut m={s.macros} />
          </section>
        </>
      )}

      <section className={cardCls} aria-label="BMI">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">BMI</h2>
          <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ background: CATEGORY_COLOR[derived.bmiCategory] }}>
            {CATEGORY_LABEL[derived.bmiCategory]}
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between gap-2">
          <p><span className="text-3xl font-bold">{derived.bmi}</span> <span className={`text-sm ${muted}`}>kg/m&sup2;</span></p>
          <p className={`text-right text-sm ${muted}`}>Latest weight {weight} kg</p>
        </div>
        <BmiGauge bmi={derived.bmi} standard={profile.bmi_standard} />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
          <Link to="/weight" className="text-teal-700 underline dark:text-teal-400">Log weight</Link>
          <Link to="/health" className="text-teal-700 underline dark:text-teal-400">Details</Link>
        </div>
      </section>

      {s && (
        <section aria-label="Meals today">
          <h2 className="mb-2 font-semibold">Meals</h2>
          <ul className="grid grid-cols-2 gap-3">
            {SLOTS.map(({ key, label }) => {
              const v = s.slotKcal[key] ?? 0;
              return (
                <li key={key}>
                  <Link to="/meals" className={`${cardCls} block min-w-0 !p-3`} aria-label={v > 0 ? `${label}, ${kcal(v)} kilocalories` : `${label}, nothing logged. Log a meal`}>
                    <p className={`text-xs ${muted}`}>{label}</p>
                    {v > 0 ? (
                      <p className="mt-1 text-lg font-bold">{kcal(v)} <span className={`text-xs font-normal ${muted}`}>kcal</span></p>
                    ) : (
                      <p className="mt-1 text-sm font-medium text-teal-700 dark:text-teal-400">+ Log a meal</p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <Disclaimer />

      <button
        type="button" onClick={() => setAdding(true)}
        className="fixed bottom-20 right-4 z-20 rounded-full bg-teal-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-teal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
      >
        + Add Activity
      </button>
      {adding && <AddActivitySheet onClose={closeAdd} />}
    </div>
  );
}
