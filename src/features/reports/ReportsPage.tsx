import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildInsights, presetRange, shiftRange, summarizeRange, validateCustomRange,
  type DateRange, type RangePreset, type ReportInputs, type RangeSummary,
} from "@fittrack/shared";
import { useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile";
import { loadReportInputs, toReportProfile } from "@/lib/rangeData";
import { istToday } from "@/lib/time";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { Banner, Field, cardCls, inputCls } from "../profile/ui";
import {
  HrChart, CaloriesChart, MacroChart, MacroPctBars, NetChart, SlotChart, SourceChart, SplitChart, TypeChart, WeightChart, ZoneChart,
} from "./charts";
import { PRESET_LABEL, createRequestGuard, fmtHours, fmtInt, fmtKg, fmtSigned, plural, rangeLabel, safe, weightChangeText } from "./logic";

import { ExportMenu } from "./export/ExportMenu";

const PRESETS: RangePreset[] = ["day", "week", "month", "custom"];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 break-words text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}

function Stats({ s }: { s: RangeSummary }) {
  const none = s.loggedDays === 0;
  return (
    <section aria-label="Summary" className="space-y-2">
      <p className="text-sm font-medium">{s.loggedDays} of {plural(s.totalDays, "day")} logged</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Average in" value={none ? "n/a" : `${fmtInt(s.avgKcalIn)} kcal`} hint="logged days" />
        <Stat label="Average out (estimated)" value={none ? "n/a" : `${fmtInt(s.avgKcalOut)} kcal`} hint="BMR + active" />
        <Stat label="Average net (estimated)" value={none ? "n/a" : `${fmtSigned(s.avgNet)} kcal`} hint="in minus out" />
        <Stat label="On target" value={none ? "n/a" : `${s.onTargetDays} on, ${s.overTargetDays} over`} hint="logged days" />
        <Stat label="Active time" value={fmtHours(s.activity.totalHours)} hint={plural(s.activity.workouts, "activity", "activities")} />
        <Stat label="Weight change (estimated)" value={weightChangeText(s)} hint="7,700 kcal is about 1 kg" />
      </div>
    </section>
  );
}

function Details({ s, targetKg }: { s: RangeSummary; targetKg: number }) {
  const w = s.weight;
  const insights = useMemo(() => buildInsights(s), [s]);
  return (
    <>
      <section className={cardCls} aria-label="Estimated weight change">
        <h2 className="font-semibold">Estimated weight change</h2>
        <p className="mt-1 text-2xl font-semibold">{weightChangeText(s)}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Based on the net calories of your logged days. 7,700 kcal is about 1 kg, so this is a rough estimate and not a measured weight.
        </p>
      </section>

      <section className={cardCls} aria-label="Progress toward target weight">
        <h2 className="font-semibold">Progress toward target weight</h2>
        {w.latestKg == null && w.progressPct == null ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No weight logged yet.</p>
        ) : (
          <>
            <div className="mt-1 flex justify-between text-sm"><span>{w.latestKg != null ? <>Latest in range <b>{fmtKg(w.latestKg)}</b></> : "No weight logged in this range"}</span><span>Target <b>{fmtKg(targetKg)}</b></span></div>
            {w.progressPct != null && (
              <>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={Math.round(safe(w.progressPct))} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to target weight">
                  <div className="h-full bg-teal-600" style={{ width: `${Math.min(100, Math.max(0, safe(w.progressPct)))}%` }} />
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{Math.round(safe(w.progressPct))}% of the way from your first logged weight.</p>
              </>
            )}
          </>
        )}
      </section>

      <section className={cardCls} aria-label="Highest-calorie foods">
        <h2 className="font-semibold">Highest-calorie foods</h2>
        {s.topFoods.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No foods logged.</p>
        ) : (
          <ol className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-700">
            {s.topFoods.map((f) => (
              <li key={f.name} className="flex justify-between gap-3 py-1.5">
                <span className="min-w-0 break-words">{f.name}{f.count > 1 && <span className="text-slate-500 dark:text-slate-400"> x{f.count}</span>}</span>
                <span className="shrink-0 font-medium">{fmtInt(f.kcal)} kcal</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={cardCls} aria-label="Insights">
        <h2 className="font-semibold">Insights</h2>
        {insights.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Not enough data for insights yet.</p>
        ) : (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{insights.map((t, i) => <li key={i}>{t}</li>)}</ul>
        )}
      </section>
    </>
  );
}

export function ReportsPage() {
  const { user } = useSession();
  const { profile, loading: profileLoading, error: profileError, refresh } = useProfile();
  // Key the profile by value so an unrelated profile refresh (same numbers) does not refetch the report.
  const profileKey = JSON.stringify(toReportProfile(profile));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reportProfile = useMemo(() => toReportProfile(profile), [profileKey]);

  const [today] = useState(() => istToday());
  const [preset, setPreset] = useState<RangePreset>("week");
  const [range, setRange] = useState<DateRange>(() => presetRange("week", istToday()));
  const [customFrom, setCustomFrom] = useState(range.from);
  const [customTo, setCustomTo] = useState(range.to);
  const [inputs, setInputs] = useState<ReportInputs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const guard = useRef(createRequestGuard());

  const customError = preset === "custom" ? validateCustomRange(customFrom, customTo, today) : null;

  useEffect(() => {
    if (!user || !reportProfile) return;
    const id = guard.current.next();
    setLoading(true);
    setError(null);
    loadReportInputs(user.id, range, today, reportProfile)
      .then((r) => { if (guard.current.isCurrent(id)) { setInputs(r); setLoading(false); } })
      .catch((e: unknown) => {
        if (!guard.current.isCurrent(id)) return;
        setInputs(null); // never show another range's figures under this range's label
        setError(e instanceof Error ? e.message : "Could not load your report.");
        setLoading(false);
      });
  }, [user, reportProfile, range, today, tick]);

  const summary = useMemo(() => (inputs ? summarizeRange(inputs) : null), [inputs]);

  const choosePreset = (p: RangePreset) => {
    setPreset(p);
    if (p === "custom") {
      setCustomFrom(range.from);
      setCustomTo(range.to);
    } else {
      setRange(presetRange(p, range.to > today ? today : range.to));
    }
  };

  const onCustom = (from: string, to: string) => {
    setCustomFrom(from);
    setCustomTo(to);
    if (validateCustomRange(from, to, today) === null) setRange({ from, to });
  };

  const shift = useCallback((dir: -1 | 1) => {
    const next = shiftRange(range, dir, today);
    setRange(next);
    setCustomFrom(next.from);
    setCustomTo(next.to);
  }, [range, today]);

  if (profileLoading) return <Spinner label="Loading reports" />;
  if (profileError) return <ErrorState message={`Could not load your profile: ${profileError}`} onRetry={() => void refresh()} />;
  if (!reportProfile) {
    return (
      <div className="mx-auto max-w-md p-4">
        <EmptyState title="Complete your profile" hint="Reports need your targets and body measurements."
          action={<Link to="/onboarding" className="inline-block rounded-lg bg-teal-600 px-4 py-2 font-medium text-white">Complete your profile</Link>} />
      </div>
    );
  }

  const atToday = range.to >= today;
  const navBtn = "rounded-lg border border-slate-300 px-3 py-2 text-lg leading-none hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800";
  const empty = summary != null && summary.loggedDays === 0 && summary.activity.workouts === 0 && summary.weight.series.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-x-hidden p-4 pb-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Reports</h1>
        {loading && inputs && <span role="status" className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"><span className="h-3 w-3 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />Updating</span>}
      </div>

      <section className={`${cardCls} space-y-3`} aria-label="Range">
        <div role="group" aria-label="Range type" className="grid grid-cols-4 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
          {PRESETS.map((p) => (
            <button key={p} type="button" aria-pressed={preset === p} onClick={() => choosePreset(p)}
              className={`rounded-md px-2 py-1.5 text-sm font-medium ${preset === p ? "bg-teal-600 text-white" : "text-slate-700 hover:bg-slate-200 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
              {PRESET_LABEL[p]}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className={navBtn} onClick={() => shift(-1)} aria-label="Previous range">&lsaquo;</button>
          <p className="min-w-0 text-center text-sm font-medium" aria-live="polite">{rangeLabel(range)} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">(IST)</span></p>
          <button type="button" className={navBtn} onClick={() => shift(1)} disabled={atToday} aria-label="Next range">&rsaquo;</button>
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-3">
            <Field id="r-from" label="From" error={customError ?? undefined}>
              <input id="r-from" type="date" className={inputCls} value={customFrom} max={today} onChange={(e) => onCustom(e.target.value, customTo)} aria-invalid={customError != null} />
            </Field>
            <Field id="r-to" label="To">
              <input id="r-to" type="date" className={inputCls} value={customTo} max={today} onChange={(e) => onCustom(customFrom, e.target.value)} aria-invalid={customError != null} />
            </Field>
          </div>
        )}
      </section>

      <ExportMenu range={range} summary={summary} inputs={inputs} loading={loading} empty={empty} userName={profile?.name ?? null} />

      {error && <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />}
      {!summary && loading && <Spinner label="Loading report" />}

      {summary && (
        <div className={`space-y-4 ${loading ? "opacity-70" : ""}`} aria-busy={loading}>
          <Banner kind="info">Entries still queued offline appear here after they sync.</Banner>
          {empty ? (
            <EmptyState title="Nothing logged in this range" hint="Log a meal, activity or weight and it will show up here. Try another range with the arrows above." />
          ) : (
            <>
              <Stats s={summary} />
              <CaloriesChart s={summary} />
              <NetChart s={summary} />
              <SlotChart s={summary} />
              <section className={cardCls} aria-label="Macro percent of target">
                <h2 className="mb-2 font-semibold">Macros as a percent of target</h2>
                <MacroPctBars s={summary} />
              </section>
              <MacroChart s={summary} />
              <SplitChart s={summary} />
              <WeightChart s={summary} />
              <TypeChart s={summary} />
              <SourceChart s={summary} />
              {summary.hr.hasData ? (
                <>
                  <HrChart s={summary} />
                  <ZoneChart s={summary} />
                </>
              ) : (
                <section className={cardCls} aria-label="Heart rate"><h2 className="font-semibold">Heart rate</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">No heart-rate data in this range.</p></section>
              )}
              <Details s={summary} targetKg={reportProfile.targetWeightKg} />
            </>
          )}
        </div>
      )}
      <Disclaimer />
    </div>
  );
}
