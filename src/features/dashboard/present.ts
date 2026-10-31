/** Pure presentation helpers for the Today screen. No math beyond drawing geometry; numbers come from @fittrack/shared. */

const num = (n: number): number => (Number.isFinite(n) ? n : 0);

/** Clamp a ratio to 0..1; NaN, Infinity and a zero or negative denominator give 0. */
export function ratio(value: number, total: number): number {
  const v = num(value);
  const t = num(total);
  if (t <= 0 || v <= 0) return 0;
  return Math.min(1, v / t);
}

/** Whole percent 0..100 (clamped) for progress bars. */
export function percent(value: number, total: number): number {
  return Math.round(ratio(value, total) * 100);
}

export interface RingGeometry { radius: number; circumference: number; dashArray: string; dashOffset: number; fraction: number }

/** Ring that fills as the allowance is consumed. Over or full = a complete ring. */
export function ringGeometry(consumed: number, allowance: number, radius = 54): RingGeometry {
  const circumference = 2 * Math.PI * radius;
  const fraction = allowance <= 0 || !Number.isFinite(allowance) ? (num(consumed) > 0 ? 1 : 0) : ratio(consumed, allowance);
  return { radius, circumference, dashArray: `${circumference}`, dashOffset: circumference * (1 - fraction), fraction };
}

export interface RingLabel { big: string; caption: string; aria: string; over: boolean }

const fmt = (n: number): string => Math.round(num(n)).toLocaleString("en-IN");

/** Wording for the centre of the ring. `over` comes from the snapshot; the over amount is its negated remaining. */
export function ringLabel(remainingKcal: number, over: boolean): RingLabel {
  const r = num(remainingKcal);
  if (over) {
    const amount = fmt(Math.abs(r));
    return { big: amount, caption: "kcal over", aria: `${amount} kilocalories over your allowance today`, over: true };
  }
  const amount = fmt(Math.max(0, r));
  return { big: amount, caption: "kcal left", aria: `${amount} kilocalories remaining today`, over: false };
}

export interface DonutSlice { key: "protein" | "carbs" | "fat"; label: string; kcal: number; share: number; dash: number; gap: number; offset: number }

/** Kcal share of macros (protein 4, carbs 4, fat 9). Returns [] when there are no macros. */
export function donutSlices(m: { proteinG: number; carbsG: number; fatG: number }, radius = 40): DonutSlice[] {
  const parts = [
    { key: "protein" as const, label: "Protein", kcal: Math.max(0, num(m.proteinG)) * 4 },
    { key: "carbs" as const, label: "Carbs", kcal: Math.max(0, num(m.carbsG)) * 4 },
    { key: "fat" as const, label: "Fat", kcal: Math.max(0, num(m.fatG)) * 9 },
  ];
  const total = parts.reduce((s, p) => s + p.kcal, 0);
  if (total <= 0) return [];
  const c = 2 * Math.PI * radius;
  let acc = 0;
  return parts.map((p) => {
    const share = p.kcal / total;
    const dash = share * c;
    const slice = { ...p, share, dash, gap: c - dash, offset: -acc };
    acc += dash;
    return slice;
  });
}

/** True when the cached snapshot's date is no longer the IST date (refetch needed). */
export function isStale(snapshotDate: string | null | undefined, today: string): boolean {
  return !snapshotDate || snapshotDate !== today;
}

/** "1h 05m" / "45 min" for active minutes. */
export function activeTimeLabel(min: number): string {
  const m = Math.max(0, Math.round(num(min)));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
