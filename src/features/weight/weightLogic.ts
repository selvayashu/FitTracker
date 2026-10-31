export interface LogLite { date: string; weight_kg: number }

/** Latest entry by date (YYYY-MM-DD sorts lexicographically), or null. */
export function latestLog<T extends LogLite>(logs: T[]): T | null {
  return logs.reduce<T | null>((best, l) => (best === null || l.date > best.date ? l : best), null);
}

/** Validate a weight entry; returns an error message or null. */
export function validateWeightEntry(weightText: string, date: string, today: string): { error: string | null; weight: number } {
  const t = weightText.trim();
  const w = t === "" ? NaN : Number(t);
  if (Number.isNaN(w)) return { error: "Enter your weight in kg.", weight: NaN };
  if (w < 20 || w > 400) return { error: "Weight must be between 20 and 400 kg.", weight: w };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose a date.", weight: w };
  if (date > today) return { error: "The date cannot be in the future.", weight: w };
  return { error: null, weight: Math.round(w * 10) / 10 };
}

/** Share of the way from the first logged weight to the target, clamped 0..100. */
export function progressPct(startKg: number, currentKg: number, targetKg: number): number {
  const total = targetKg - startKg;
  if (total === 0) return 100;
  return Math.max(0, Math.min(100, Math.round(((currentKg - startKg) / total) * 100)));
}
