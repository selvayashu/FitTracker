import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { getOutboxState, subscribeOutbox, type OutboxState } from "@/lib/outbox";
import { useSession } from "@/lib/session";
import { addDaysIst, formatDuration, formatIstDate, istDateOf, istTimeOf, istToday } from "@/lib/time";
import type { ActivityRow, ActivityTemplateRow, ActivityTypeRow } from "@/lib/database.types";
import { AddActivitySheet } from "./AddActivitySheet";
import {
  activityLabel, cloneForRepeat, daySummary, groupByIstDate, templateFromRow, templateToPrefill, type ActivityPrefill,
} from "./logic";
import {
  deleteActivity, deleteTemplate, hydrate, loadActivities, loadTemplates, loadTypes, saveActivity, saveTemplate, useActivityStore,
} from "./store";

const PAGE_DAYS = 14;

type SheetState = { prefill?: ActivityPrefill; editing?: ActivityRow } | null;

function useOutbox(): OutboxState {
  const [s, setS] = useState(getOutboxState());
  useEffect(() => subscribeOutbox(setS), []);
  return s;
}

export function ActivityPage() {
  const { user } = useSession();
  const { activities, templates, types } = useActivityStore();
  const outbox = useOutbox();
  const [days, setDays] = useState(PAGE_DAYS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const userId = user?.id ?? null;

  useEffect(() => { if (userId) hydrate(userId); }, [userId]);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    const from = new Date(`${addDaysIst(istToday(), -(days - 1))}T00:00:00+05:30`).toISOString();
    try {
      await Promise.all([loadTypes(), loadActivities(userId, from, getOutboxState().pending > 0), loadTemplates(userId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load activities.");
    } finally {
      setLoading(false);
    }
  }, [userId, days]);

  useEffect(() => { void load(); }, [load]);

  const today = istToday();
  const cutoff = addDaysIst(today, -(days - 1));
  const visible = useMemo(() => activities.filter((a) => istDateOf(a.start_time) >= cutoff), [activities, cutoff]);
  const groups = useMemo(() => groupByIstDate(visible), [visible]);
  const todaySummary = useMemo(() => daySummary(visible.filter((a) => istDateOf(a.start_time) === today)), [visible, today]);

  const repeat = (a: ActivityRow) => void saveActivity(cloneForRepeat(a, { id: crypto.randomUUID(), now: new Date() }));
  const makeTemplate = (a: ActivityRow) => void saveTemplate(templateFromRow(a, types, { id: crypto.randomUUID() }));
  const remove = (a: ActivityRow) => {
    if (window.confirm(`Delete ${activityLabel(a, types)}?`)) void deleteActivity(a.id);
  };

  const hasCache = activities.length > 0 || types.length > 0;
  const showError = error !== null && !hasCache;

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-28">
      <h1 className="text-xl font-semibold">Activity</h1>

      {!outbox.online && (
        <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          You are offline. Showing saved data; new activities sync when you reconnect.
        </p>
      )}
      {error && hasCache && outbox.online && <ErrorState message={`Could not refresh: ${error}`} onRetry={() => void load()} />}

      <section aria-label="Today summary" className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800">
        <p className="text-xs text-slate-500 dark:text-slate-400">Today</p>
        <p className="text-lg font-semibold">
          {todaySummary.minutes} active min <span className="text-slate-400">·</span> {todaySummary.kcal} kcal
        </p>
        {todaySummary.anyEstimated && <p className="text-xs text-slate-500 dark:text-slate-400">Some calorie values are estimated.</p>}
      </section>

      {templates.length > 0 && (
        <section aria-label="Templates">
          <h2 className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Quick add</h2>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {templates.map((t) => (
              <TemplateChip key={t.id} t={t} types={types} onUse={() => setSheet({ prefill: templateToPrefill(t) })} />
            ))}
          </ul>
        </section>
      )}

      {loading && activities.length === 0 ? <Spinner /> : showError ? (
        <ErrorState message={error!} onRetry={() => void load()} />
      ) : groups.length === 0 ? (
        <EmptyState title="No activity yet, tap + Add Activity" hint="Log a walk, workout or sport to see it here." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.date} aria-label={g.date}>
              <h2 className="mb-1 text-sm font-medium text-slate-600 dark:text-slate-300">
                {g.date === today ? "Today" : formatIstDate(g.date)}
              </h2>
              <ul className="space-y-2">
                {g.items.map((a) => (
                  <ActivityCard key={a.id} a={a} types={types}
                    onEdit={() => setSheet({ editing: a })} onRepeat={() => repeat(a)}
                    onTemplate={() => makeTemplate(a)} onDelete={() => remove(a)} />
                ))}
              </ul>
            </section>
          ))}
          <button onClick={() => setDays((d) => d + PAGE_DAYS)} disabled={loading}
            className="w-full rounded-lg border border-slate-300 py-2 text-sm dark:border-slate-600">
            {loading ? "Loading..." : "Load more"}
          </button>
        </div>
      )}

      <button onClick={() => setSheet({})} aria-label="Add Activity"
        className="fixed bottom-20 right-4 z-30 rounded-full bg-teal-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
        + Add Activity
      </button>
      {sheet && <AddActivitySheet prefill={sheet.prefill} editing={sheet.editing} onClose={() => setSheet(null)} />}
    </div>
  );
}

function TemplateChip({ t, types, onUse }: { t: ActivityTemplateRow; types: ActivityTypeRow[]; onUse: () => void }) {
  const typeName = types.find((x) => x.id === t.activity_type_id)?.name;
  return (
    <li className="flex shrink-0 items-center rounded-full border border-slate-300 text-sm dark:border-slate-600">
      <button onClick={onUse} className="py-1 pl-3 pr-2" aria-label={`Use template ${t.name}`}>
        {t.name} <span className="text-xs text-slate-500">{formatDuration(Math.round(t.duration_min))}{typeName && typeName !== t.name ? ` ${typeName}` : ""}</span>
      </button>
      <button onClick={() => { if (window.confirm(`Delete template ${t.name}?`)) void deleteTemplate(t.id); }}
        aria-label={`Delete template ${t.name}`} className="py-1 pl-1 pr-3 text-slate-400">x</button>
    </li>
  );
}

function ActivityCard({ a, types, onEdit, onRepeat, onTemplate, onDelete }: {
  a: ActivityRow; types: ActivityTypeRow[]; onEdit: () => void; onRepeat: () => void; onTemplate: () => void; onDelete: () => void;
}) {
  const manual = a.source === "manual";
  const btn = "rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-600";
  return (
    <li className="rounded-xl bg-white p-3 shadow-sm dark:bg-slate-800">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{activityLabel(a, types)}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {istTimeOf(a.start_time)} IST · {formatDuration(Math.round(Number(a.duration_min)))}
            {a.distance_km !== null && ` · ${Number(a.distance_km)} km`}
            {a.avg_hr !== null && ` · avg ${a.avg_hr} bpm`}
          </p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs ${manual ? "bg-slate-100 dark:bg-slate-700" : "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100"}`}>
          {manual ? "Manual" : "Strava"}
        </span>
      </div>
      <p className="mt-1 text-sm">
        {a.calories !== null ? `${Math.round(Number(a.calories))} kcal` : "kcal not set"}
        {a.calories_estimated && a.calories !== null && (
          <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">estimated</span>
        )}
      </p>
      {a.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{a.notes}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button className={btn} onClick={onEdit}>{manual ? "Edit" : "Edit notes"}</button>
        <button className={btn} onClick={onRepeat}>Repeat</button>
        <button className={btn} onClick={onTemplate}>Save as template</button>
        {manual && <button className={`${btn} text-red-600 dark:text-red-400`} onClick={onDelete}>Delete</button>}
      </div>
    </li>
  );
}
