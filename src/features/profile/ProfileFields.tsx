import { useMemo, type Dispatch, type SetStateAction } from "react";
import { computeProfileDerived, type ActivityLevel, type Goal, type Pace } from "@fittrack/shared";
import { cmToFtIn } from "./saveProfile";
import { heightFromForm, parseProfileForm, type FormErrors, type ProfileFormState } from "./formModel";
import { Banner, BmiGauge, CATEGORY_COLOR, CATEGORY_LABEL, Field, cardCls, inputCls } from "./ui";

const ACTIVITY: { value: ActivityLevel; label: string; hint: string }[] = [
  { value: "sedentary", label: "Sedentary", hint: "Desk job, little or no exercise" },
  { value: "light", label: "Lightly active", hint: "Light exercise or sport 1-3 days a week" },
  { value: "moderate", label: "Moderately active", hint: "Moderate exercise 3-5 days a week" },
  { value: "active", label: "Very active", hint: "Hard exercise 6-7 days a week" },
  { value: "very_active", label: "Extremely active", hint: "Physical job plus daily hard training" },
];
const GOALS: { value: Goal; label: string }[] = [
  { value: "lose", label: "Lose weight" }, { value: "maintain", label: "Maintain" }, { value: "gain", label: "Gain weight" },
];

type Setter = Dispatch<SetStateAction<ProfileFormState>>;

function Segmented<T extends string | number>({ label, value, options, onChange, error }: {
  label: string; value: T | ""; options: { value: T; label: string }[]; onChange: (v: T) => void; error?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}
            className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${value === o.value
              ? "border-teal-600 bg-teal-600 text-white"
              : "border-slate-300 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"}`}
          >{o.label}</button>
        ))}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </fieldset>
  );
}

/** Shared profile form body for onboarding and settings. */
export function ProfileFields({ form, setForm, errors, settings = false }: {
  form: ProfileFormState; setForm: Setter; errors: FormErrors; settings?: boolean;
}) {
  const set = <K extends keyof ProfileFormState>(k: K, v: ProfileFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: keyof ProfileFormState) => errors[k];
  const switchUnit = (unit: "cm" | "ftin") => setForm((f) => {
    if (unit === f.heightUnit) return f;
    const cm = heightFromForm(f);
    if (Number.isNaN(cm)) return { ...f, heightUnit: unit };
    if (unit === "ftin") {
      const { ft, inch } = cmToFtIn(cm);
      return { ...f, heightUnit: unit, ft: String(ft), inch: String(inch) };
    }
    return { ...f, heightUnit: unit, heightCm: String(Math.round(cm * 10) / 10) };
  });

  return (
    <div className="space-y-4">
      <Field id="pf-name" label="Name (optional)" error={err("name")}>
        <input id="pf-name" className={inputCls} value={form.name} autoComplete="name" onChange={(e) => set("name", e.target.value)} />
      </Field>
      <Field id="pf-dob" label="Date of birth" error={err("dob")}>
        <input id="pf-dob" type="date" className={inputCls} value={form.dob} aria-invalid={!!err("dob")} onChange={(e) => set("dob", e.target.value)} />
      </Field>
      <Segmented label="Sex (used for the calorie formula)" value={form.sex} onChange={(v) => set("sex", v)} error={err("sex")}
        options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} />

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium">Height</span>
          <div className="flex gap-1 text-xs">
            {(["cm", "ftin"] as const).map((u) => (
              <button key={u} type="button" aria-pressed={form.heightUnit === u} onClick={() => switchUnit(u)}
                className={`rounded-md px-2 py-1 ${form.heightUnit === u ? "bg-teal-600 text-white" : "border border-slate-300 dark:border-slate-600"}`}>
                {u === "cm" ? "cm" : "ft / in"}
              </button>
            ))}
          </div>
        </div>
        {form.heightUnit === "cm" ? (
          <input id="pf-height" aria-label="Height in centimetres" inputMode="decimal" className={inputCls} value={form.heightCm} placeholder="e.g. 170" onChange={(e) => set("heightCm", e.target.value)} />
        ) : (
          <div className="flex gap-2">
            <input aria-label="Height feet" inputMode="numeric" className={inputCls} value={form.ft} placeholder="ft" onChange={(e) => set("ft", e.target.value)} />
            <input aria-label="Height inches" inputMode="decimal" className={inputCls} value={form.inch} placeholder="in" onChange={(e) => set("inch", e.target.value)} />
          </div>
        )}
        {err("heightCm") && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{err("heightCm")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field id="pf-weight" label="Current weight (kg)" error={err("weight")}>
          <input id="pf-weight" inputMode="decimal" className={inputCls} value={form.weight} onChange={(e) => set("weight", e.target.value)} />
        </Field>
        <Field id="pf-target" label="Target weight (kg)" error={err("target")}>
          <input id="pf-target" inputMode="decimal" className={inputCls} value={form.target} onChange={(e) => set("target", e.target.value)} />
        </Field>
      </div>

      <Field id="pf-activity" label="Activity level" hint={ACTIVITY.find((a) => a.value === form.activity)?.hint ?? "How active you are in a typical week"} error={err("activity")}>
        <select id="pf-activity" className={inputCls} value={form.activity} onChange={(e) => set("activity", e.target.value as ActivityLevel)}>
          <option value="" disabled>Choose...</option>
          {ACTIVITY.map((a) => <option key={a.value} value={a.value}>{a.label} - {a.hint}</option>)}
        </select>
      </Field>

      <Segmented label="Goal" value={form.goal} options={GOALS} onChange={(v) => set("goal", v)} error={err("goal")} />
      {(form.goal === "lose" || form.goal === "gain") && (
        <Segmented<Pace> label="Pace" value={form.pace} onChange={(v) => set("pace", v)}
          options={[{ value: 0.25, label: "0.25 kg / week (gentle)" }, { value: 0.5, label: "0.5 kg / week (steady)" }]} />
      )}

      {settings && (
        <>
          <Segmented label="BMI standard" value={form.bmiStandard} onChange={(v) => set("bmiStandard", v)}
            options={[{ value: "asian", label: "Asian (default)" }, { value: "who", label: "WHO" }]} />
          <div className="grid grid-cols-2 gap-3">
            <Field id="pf-addback" label="Exercise add-back (%)" hint="Share of exercise calories added to your day" error={err("addback")}>
              <input id="pf-addback" inputMode="numeric" className={inputCls} value={form.addback} onChange={(e) => set("addback", e.target.value)} />
            </Field>
            <Field id="pf-maxhr" label="Max heart rate (bpm)" hint="Blank = 220 minus age" error={err("maxHr")}>
              <input id="pf-maxhr" inputMode="numeric" className={inputCls} value={form.maxHr} onChange={(e) => set("maxHr", e.target.value)} />
            </Field>
          </div>
        </>
      )}
    </div>
  );
}

/** Live BMI / target preview computed with the shared module. */
export function ProfilePreview({ form }: { form: ProfileFormState }) {
  const derived = useMemo(() => {
    const { value } = parseProfileForm(form);
    return value ? computeProfileDerived(value) : null;
  }, [form]);
  if (!derived) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">Fill in the fields above to preview your BMI and daily calorie target.</p>;
  }
  return (
    <div className={cardCls} aria-live="polite">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-slate-500 dark:text-slate-400">Preview</p>
        <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: CATEGORY_COLOR[derived.bmiCategory] }}>{CATEGORY_LABEL[derived.bmiCategory]}</span>
      </div>
      <p className="mt-1"><span className="text-2xl font-bold">{derived.bmi}</span> <span className="text-sm text-slate-500">BMI</span></p>
      <BmiGauge bmi={derived.bmi} standard={form.bmiStandard} />
      <p className="mt-3 text-sm">Daily target: <b>{derived.dailyKcalTarget.toLocaleString("en-IN")} kcal</b></p>
      {derived.floorApplied && (
        <div className="mt-2"><Banner kind="warn">Your chosen pace would drop below the safe minimum, so your target is held at {derived.dailyKcalTarget.toLocaleString("en-IN")} kcal. Progress will be slower than the pace you picked.</Banner></div>
      )}
    </div>
  );
}
