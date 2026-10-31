import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Intensity } from "@fittrack/shared";
import { Sheet } from "@/components/Sheet";
import { useProfile } from "@/lib/profile";
import { useSession } from "@/lib/session";
import { istToday, parseDuration } from "@/lib/time";
import type { ActivityRow } from "@/lib/database.types";
import {
  buildActivityRow, emptyForm, estimateKcal, hasErrors, isOther, rowToForm, templateFromForm, validateForm,
  type ActivityFormValues, type ActivityPrefill, type FormErrors,
} from "./logic";
import { hydrate, loadTypes, saveActivity, saveStravaNotes, saveTemplate, useActivityStore } from "./store";

export interface AddActivitySheetProps {
  onClose: () => void;
  prefill?: ActivityPrefill;
  /** Edit this existing row (keeps its id). Strava rows only allow notes. */
  editing?: ActivityRow;
}

const INTENSITIES: { value: Intensity; label: string }[] = [
  { value: "light", label: "Light" }, { value: "moderate", label: "Moderate" }, { value: "vigorous", label: "Vigorous" },
];

const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900";

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function AddActivitySheet({ onClose, prefill, editing }: AddActivitySheetProps) {
  const { user } = useSession();
  const { profile } = useProfile();
  const { types } = useActivityStore();
  const [typesError, setTypesError] = useState<string | null>(null);
  const [form, setForm] = useState<ActivityFormValues>(() => (editing ? rowToForm(editing) : { ...emptyForm(), ...prefill }));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { if (user) hydrate(user.id); }, [user]);
  useEffect(() => {
    if (types.length === 0) loadTypes().catch((e: unknown) => setTypesError(e instanceof Error ? e.message : "Could not load activity types."));
  }, [types.length]);

  const readOnly = editing?.source === "strava";
  const today = istToday();
  const errors: FormErrors = useMemo(() => (readOnly ? {} : validateForm(form, types, today)), [form, types, today, readOnly]);
  const type = types.find((t) => t.id === form.typeId);
  const weight = profile?.weight_kg ?? null;
  const durationMin = parseDuration(form.duration);
  const estimate = estimateKcal(type, form.intensity, weight, durationMin);
  const showErr = (k: keyof ActivityFormValues) => (touched ? errors[k] : undefined);
  const set = <K extends keyof ActivityFormValues>(k: K, v: ActivityFormValues[K]) => setForm((f) => ({ ...f, [k]: v }));
  const enteringCalories = form.calories.trim() !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!user) return;
    if (readOnly && editing) {
      setSaving(true);
      await saveStravaNotes(editing.id, form.notes);
      onClose();
      return;
    }
    if (hasErrors(errors)) return;
    const row = buildActivityRow(form, types, {
      id: editing?.id ?? crypto.randomUUID(), userId: user.id, weightKg: weight,
      source: editing?.source, stravaId: editing?.strava_id,
    });
    if (!row) return;
    setSaving(true);
    try {
      await saveActivity(row);
      onClose();
    } catch {
      setNote("Could not save this activity on your device. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function saveAsTemplate() {
    setTouched(true);
    if (!user) return;
    const t = templateFromForm(form, types, { id: crypto.randomUUID(), userId: user.id });
    if (!t || errors.duration || errors.typeId) { setNote("Pick a type and a valid duration first."); return; }
    await saveTemplate(t);
    setNote(`Saved template "${t.name}".`);
  }

  return (
    <Sheet title={editing ? "Edit activity" : "Add activity"} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
        {readOnly ? (
          <p className="rounded-lg bg-slate-100 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            This activity was synced from Strava. Only notes can be edited.
          </p>
        ) : (
          <>
            <Field id="act-type" label="Activity type" error={showErr("typeId") ?? typesError ?? undefined}>
              <select id="act-type" className={inputCls} value={form.typeId ?? ""} aria-invalid={!!showErr("typeId")}
                onChange={(e) => set("typeId", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select...</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            {isOther(type) && (
              <Field id="act-name" label="Activity name" error={showErr("customName")}>
                <input id="act-name" className={inputCls} value={form.customName} maxLength={60} aria-invalid={!!showErr("customName")}
                  onChange={(e) => set("customName", e.target.value)} />
              </Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field id="act-date" label="Date (IST)" error={showErr("date")}>
                <input id="act-date" type="date" className={inputCls} value={form.date} max={today} onChange={(e) => set("date", e.target.value)} />
              </Field>
              <Field id="act-time" label="Start time (IST)" error={showErr("time")}>
                <input id="act-time" type="time" className={inputCls} value={form.time} onChange={(e) => set("time", e.target.value)} />
              </Field>
            </div>
            <Field id="act-duration" label="Duration (hh:mm)" error={showErr("duration")} hint="1 minute to 10 hours">
              <input id="act-duration" inputMode="numeric" placeholder="00:45" className={inputCls} value={form.duration}
                aria-invalid={!!showErr("duration")} onChange={(e) => set("duration", e.target.value)} />
            </Field>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-300">Intensity</legend>
              <div className="grid grid-cols-3 gap-2">
                {INTENSITIES.map((i) => (
                  <button key={i.value} type="button" aria-pressed={form.intensity === i.value} onClick={() => set("intensity", i.value)}
                    className={`rounded-lg border px-2 py-2 text-sm ${form.intensity === i.value
                      ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 dark:border-slate-600"}`}>
                    {i.label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <Field id="act-dist" label={type?.has_distance === false ? "Distance (km, optional)" : "Distance (km)"} error={showErr("distance")}>
                <input id="act-dist" inputMode="decimal" className={inputCls} value={form.distance} onChange={(e) => set("distance", e.target.value)} />
              </Field>
              <Field id="act-steps" label="Steps" error={showErr("steps")}>
                <input id="act-steps" inputMode="numeric" className={inputCls} value={form.steps} onChange={(e) => set("steps", e.target.value)} />
              </Field>
              <Field id="act-avg" label="Avg HR (bpm)" error={showErr("avgHr")}>
                <input id="act-avg" inputMode="numeric" className={inputCls} value={form.avgHr} aria-invalid={!!showErr("avgHr")}
                  onChange={(e) => set("avgHr", e.target.value)} />
              </Field>
              <Field id="act-max" label="Max HR (bpm)" error={showErr("maxHr")}>
                <input id="act-max" inputMode="numeric" className={inputCls} value={form.maxHr} aria-invalid={!!showErr("maxHr")}
                  onChange={(e) => set("maxHr", e.target.value)} />
              </Field>
            </div>
            <Field id="act-cal" label="Calories burned (kcal, if known)" error={showErr("calories")}>
              <input id="act-cal" inputMode="numeric" className={inputCls} value={form.calories} onChange={(e) => set("calories", e.target.value)} />
            </Field>
            {!enteringCalories && (
              weight === null ? (
                <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Calorie estimation is off because your weight is missing.{" "}
                  <Link to="/onboarding" className="font-medium underline">Complete your profile</Link>.
                </p>
              ) : estimate !== null ? (
                <p aria-live="polite" className="text-sm text-teal-700 dark:text-teal-300">Estimated burn: {estimate} kcal (estimated)</p>
              ) : null
            )}
          </>
        )}
        <Field id="act-notes" label="Notes" error={showErr("notes")}>
          <textarea id="act-notes" rows={2} className={inputCls} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
        {note && <p role="status" className="text-xs text-teal-700 dark:text-teal-300">{note}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Saving..." : editing ? "Save changes" : "Save activity"}
          </button>
          {!readOnly && (
            <button type="button" onClick={() => void saveAsTemplate()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600">
              Save as template
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}
