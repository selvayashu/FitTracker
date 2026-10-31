import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { bmi as calcBmi } from "@fittrack/shared";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/session";
import { toProfileInput, useProfile } from "@/lib/profile";
import { istToday } from "@/lib/time";
import type { WeightLogRow } from "@/lib/database.types";
import { Disclaimer } from "@/components/Disclaimer";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { buildDerivedColumns } from "../profile/saveProfile";
import { persistProfile, upsertWeightLog } from "../profile/persist";
import { Banner, Field, cardCls, inputCls, primaryBtn } from "../profile/ui";
import { latestLog, progressPct, validateWeightEntry } from "./weightLogic";

export function WeightPage() {
  const { user } = useSession();
  const { profile, derived, loading: profileLoading, error: profileError, refresh } = useProfile();
  const [logs, setLogs] = useState<WeightLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState(istToday());
  const [weightText, setWeightText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.from("weight_logs").select("*").eq("user_id", user.id).order("date", { ascending: false });
    setLoadError(error ? error.message : null);
    setLogs(error ? [] : ((data ?? []) as WeightLogRow[]));
    setLoading(false);
  }, [user]);

  useEffect(() => { void load(); }, [load]);

  // If the page stays open past IST midnight, move the entry date to the new day (unless the user picked another date).
  useEffect(() => {
    let lastToday = istToday();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = istToday();
      if (now !== lastToday) { setDate((d) => (d === lastToday ? now : d)); lastToday = now; }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /** Push the weight of the latest log (or a given weight) into the profile and recompute every derived column. */
  const syncProfile = async (weightKg: number) => {
    const input = toProfileInput(profile);
    if (!user || !profile || !input) return;
    await persistProfile(user.id, { weight_kg: weightKg, ...buildDerivedColumns({ ...input, weightKg }, profile.max_hr) });
    await refresh();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    const v = validateWeightEntry(weightText, date, istToday());
    setFormError(v.error);
    if (v.error || !user || !profile?.height_cm) return;
    setBusy(true);
    try {
      await upsertWeightLog(user.id, date, v.weight, calcBmi(v.weight, profile.height_cm));
      const latest = latestLog([...logs.filter((l) => l.date !== date), { date, weight_kg: v.weight }]);
      if (latest && latest.date === date) await syncProfile(v.weight);
      setWeightText("");
      setNotice("Weight saved");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save your weight.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (log: WeightLogRow) => {
    if (!user || !window.confirm(`Delete the entry for ${log.date}?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const { error } = await supabase.from("weight_logs").delete().eq("id", log.id).eq("user_id", user.id);
      if (error) throw new Error(error.message);
      const rest = logs.filter((l) => l.id !== log.id);
      const wasLatest = latestLog(logs)?.id === log.id;
      const newLatest = latestLog(rest);
      if (wasLatest && newLatest) await syncProfile(newLatest.weight_kg);
      setNotice("Entry deleted");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not delete the entry.");
    } finally {
      setBusy(false);
    }
  };

  const chartData = useMemo(
    () => [...logs].reverse().map((l) => ({
      date: l.date,
      bmi: l.bmi ?? (profile?.height_cm ? calcBmi(l.weight_kg, profile.height_cm) : null),
    })),
    [logs, profile?.height_cm],
  );

  if (profileLoading || loading) return <Spinner label="Loading weight history" />;
  if (profileError) return <ErrorState message={`Could not load your profile: ${profileError}`} onRetry={() => void refresh()} />;
  if (!profile || !derived || !profile.height_cm || !profile.target_weight_kg) {
    return (
      <main className="mx-auto max-w-md p-4">
        <EmptyState title="Complete your profile" hint="We need your height and target weight before you can log weight."
          action={<Link to="/onboarding" className="inline-block rounded-lg bg-teal-600 px-4 py-2 font-medium text-white">Complete your profile</Link>} />
      </main>
    );
  }

  const first = logs.length ? logs[logs.length - 1] : null;
  const latest = latestLog(logs);
  const current = latest?.weight_kg ?? profile.weight_kg ?? 0;
  const pct = first ? progressPct(first.weight_kg, current, profile.target_weight_kg) : 0;

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <h1 className="text-xl font-semibold">Weight</h1>

      <section className={cardCls} aria-label="Progress">
        <div className="flex justify-between text-sm">
          <span>Latest <b>{current} kg</b></span>
          <span>Target <b>{profile.target_weight_kg} kg</b></span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to target">
          <div className="h-full bg-teal-600" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {first ? `${pct}% of the way from ${first.weight_kg} kg` : "Log your first weight to start tracking progress."} {Math.abs(current - profile.target_weight_kg).toFixed(1)} kg to go.
        </p>
      </section>

      <form onSubmit={save} className={`${cardCls} space-y-3`} noValidate>
        <h2 className="font-semibold">Log weight</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field id="w-date" label="Date">
            <input id="w-date" type="date" className={inputCls} value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="w-kg" label="Weight (kg)">
            <input id="w-kg" inputMode="decimal" className={inputCls} value={weightText} placeholder="e.g. 72.5" onChange={(e) => setWeightText(e.target.value)} />
          </Field>
        </div>
        {formError && <Banner kind="error">{formError}</Banner>}
        {notice && <Banner kind="success">{notice}</Banner>}
        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? "Saving..." : "Save weight"}</button>
      </form>

      {loadError && <ErrorState message={`Could not load history: ${loadError}`} onRetry={() => void load()} />}

      <section className={cardCls} aria-label="BMI trend">
        <h2 className="mb-2 font-semibold">BMI trend</h2>
        {chartData.length < 2 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Log at least two weights to see your trend.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(n: number) => n.toFixed(0)} />
                <Tooltip formatter={(v: number) => [v, "BMI"]} />
                <Line type="monotone" dataKey="bmi" stroke="#0d9488" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section aria-label="History">
        <h2 className="mb-2 font-semibold">History</h2>
        {logs.length === 0 ? (
          <EmptyState title="No weights logged yet" hint="Add today's weight above." />
        ) : (
          <ul className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
            {logs.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{l.date}</span>
                <span className="font-medium">{l.weight_kg} kg{l.bmi != null && <span className="ml-2 font-normal text-slate-500 dark:text-slate-400">BMI {l.bmi}</span>}</span>
                <button type="button" disabled={busy} onClick={() => void remove(l)} aria-label={`Delete entry for ${l.date}`} className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950">Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Disclaimer />
    </main>
  );
}
