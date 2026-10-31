import type { ReactNode } from "react";
import type { BmiCategory, BmiStandard } from "@fittrack/shared";

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100";
export const primaryBtn =
  "w-full rounded-lg bg-teal-600 px-4 py-2.5 font-medium text-white hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60";
export const secondaryBtn =
  "rounded-lg border border-slate-300 px-4 py-2.5 font-medium hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:hover:bg-slate-800";
export const cardCls = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800";

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function Banner({ kind, children }: { kind: "error" | "success" | "warn" | "info"; children: ReactNode }) {
  const cls = {
    error: "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
    success: "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200",
    warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
    info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${cls}`}>{children}</div>;
}

export const CATEGORY_LABEL: Record<BmiCategory, string> = {
  underweight: "Underweight", normal: "Healthy weight", overweight: "Overweight", obese: "Obese",
};
export const CATEGORY_COLOR: Record<BmiCategory, string> = {
  underweight: "#2563eb", normal: "#15803d", overweight: "#d97706", obese: "#c2410c",
};

/** Colour-coded BMI scale with a marker. Range 15..35. */
export function BmiGauge({ bmi, standard }: { bmi: number; standard: BmiStandard }) {
  const min = 15, max = 35;
  const pos = Math.max(0, Math.min(1, (bmi - min) / (max - min))) * 100;
  const ow = standard === "who" ? 25 : 23;
  const ob = standard === "who" ? 30 : 25;
  const seg = (a: number, z: number, color: string) => (
    <i key={a} className="absolute inset-y-0" style={{ left: `${((a - min) / (max - min)) * 100}%`, width: `${((z - a) / (max - min)) * 100}%`, background: color }} />
  );
  return (
    <div role="img" aria-label={`BMI ${bmi} on a scale from ${min} to ${max}`} className="mt-3">
      <div className="relative h-3 overflow-hidden rounded-full">
        {seg(min, 18.5, CATEGORY_COLOR.underweight)}
        {seg(18.5, ow, CATEGORY_COLOR.normal)}
        {seg(ow, ob, CATEGORY_COLOR.overweight)}
        {seg(ob, max, CATEGORY_COLOR.obese)}
      </div>
      <div className="relative h-3">
        <span
          className="absolute top-0.5 h-0 w-0 border-x-[6px] border-b-[9px] border-x-transparent border-b-slate-800 dark:border-b-slate-100"
          style={{ left: `calc(${pos}% - 6px)` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400"><span>{min}</span><span>18.5</span><span>{ow}</span><span>{ob}</span><span>{max}+</span></div>
    </div>
  );
}

export function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
