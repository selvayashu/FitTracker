import { ageFromDob, type ActivityLevel, type ActivityTrackingMode, type BmiStandard, type Goal, type Pace, type ProfileInput, type Sex } from "@fittrack/shared";
import type { ProfileRow } from "@/lib/database.types";
import { cmToFtIn, ftInToCm, type ProfileSaveInput } from "./saveProfile";

/** Raw text state of the profile form (inputs are strings until validated). */
export interface ProfileFormState {
  name: string;
  dob: string;
  sex: Sex | "";
  heightUnit: "cm" | "ftin";
  heightCm: string;
  ft: string;
  inch: string;
  weight: string;
  target: string;
  activity: ActivityLevel | "";
  goal: Goal | "";
  pace: Pace;
  bmiStandard: BmiStandard;
  addback: string;
  maxHr: string;
  trackingMode: ActivityTrackingMode;
}

export type FormErrors = Partial<Record<keyof ProfileFormState, string>>;

export const emptyForm: ProfileFormState = {
  name: "", dob: "", sex: "", heightUnit: "cm", heightCm: "", ft: "", inch: "", weight: "", target: "",
  activity: "", goal: "", pace: 0.5, bmiStandard: "asian", addback: "50", maxHr: "", trackingMode: "manual",
};

export function formFromProfile(p: ProfileRow | null): ProfileFormState {
  if (!p) return emptyForm;
  const fi = p.height_cm ? cmToFtIn(p.height_cm) : null;
  return {
    name: p.name ?? "",
    dob: p.dob ?? "",
    sex: p.sex ?? "",
    heightUnit: "cm",
    heightCm: p.height_cm ? String(p.height_cm) : "",
    ft: fi ? String(fi.ft) : "",
    inch: fi ? String(fi.inch) : "",
    weight: p.weight_kg ? String(p.weight_kg) : "",
    target: p.target_weight_kg ? String(p.target_weight_kg) : "",
    activity: p.activity_level ?? "",
    goal: p.goal ?? "",
    pace: p.pace ?? 0.5,
    bmiStandard: p.bmi_standard,
    addback: String(p.exercise_addback_pct),
    maxHr: p.max_hr ? String(p.max_hr) : "",
    trackingMode: p.activity_tracking_mode,
  };
}

/** Parse a number from text; returns NaN for empty or malformed input. */
function num(s: string): number {
  const t = s.trim();
  return t === "" ? NaN : Number(t);
}

export function heightFromForm(f: ProfileFormState): number {
  if (f.heightUnit === "cm") return num(f.heightCm);
  const ft = num(f.ft);
  const inch = f.inch.trim() === "" ? 0 : num(f.inch);
  return Number.isNaN(ft) || Number.isNaN(inch) ? NaN : ftInToCm(ft, inch);
}

export interface ParseResult {
  errors: FormErrors;
  /** Present only when errors is empty. */
  value: ProfileSaveInput | null;
}

/** Validate the form. `settings` also validates the add-back % and max HR fields. */
export function parseProfileForm(f: ProfileFormState, opts: { settings?: boolean; now?: Date } = {}): ParseResult {
  const errors: FormErrors = {};
  const now = opts.now ?? new Date();

  if (f.name.length > 80) errors.name = "Name is too long (max 80 characters).";

  let age = NaN;
  if (!f.dob || !/^\d{4}-\d{2}-\d{2}$/.test(f.dob) || Number.isNaN(Date.parse(f.dob))) {
    errors.dob = "Enter your date of birth.";
  } else if (new Date(`${f.dob}T00:00:00Z`) > now) {
    errors.dob = "Date of birth cannot be in the future.";
  } else {
    age = ageFromDob(f.dob, now);
    if (age < 12 || age > 100) errors.dob = "Age must be between 12 and 100 years.";
  }

  if (!f.sex) errors.sex = "Choose one option.";

  const heightCm = heightFromForm(f);
  if (Number.isNaN(heightCm)) errors.heightCm = "Enter your height.";
  else if (heightCm < 100 || heightCm > 250) errors.heightCm = "Height must be between 100 and 250 cm (about 3 ft 3 in to 8 ft 2 in).";

  const weightKg = num(f.weight);
  if (Number.isNaN(weightKg)) errors.weight = "Enter your current weight.";
  else if (weightKg < 20 || weightKg > 400) errors.weight = "Weight must be between 20 and 400 kg.";

  const targetWeightKg = num(f.target);
  if (Number.isNaN(targetWeightKg)) errors.target = "Enter your target weight.";
  else if (targetWeightKg < 20 || targetWeightKg > 400) errors.target = "Target weight must be between 20 and 400 kg.";
  else if (!errors.weight && f.goal === "lose" && targetWeightKg >= weightKg) errors.target = "To lose weight, the target must be below your current weight.";
  else if (!errors.weight && f.goal === "gain" && targetWeightKg <= weightKg) errors.target = "To gain weight, the target must be above your current weight.";

  if (!f.activity) errors.activity = "Choose your activity level.";
  if (!f.goal) errors.goal = "Choose a goal.";

  let exerciseAddbackPct: number | undefined;
  let maxHr: number | null | undefined;
  if (opts.settings) {
    exerciseAddbackPct = num(f.addback);
    if (Number.isNaN(exerciseAddbackPct) || exerciseAddbackPct < 0 || exerciseAddbackPct > 100) errors.addback = "Enter a percentage from 0 to 100.";
    if (f.maxHr.trim() === "") maxHr = null;
    else {
      maxHr = num(f.maxHr);
      if (Number.isNaN(maxHr) || maxHr < 100 || maxHr > 230) errors.maxHr = "Max heart rate must be between 100 and 230 bpm.";
    }
  }

  if (Object.keys(errors).length > 0 || !f.sex || !f.activity || !f.goal) return { errors, value: null };

  const base: ProfileInput = {
    sex: f.sex, dob: f.dob, heightCm, weightKg, targetWeightKg,
    activityLevel: f.activity, goal: f.goal, pace: f.pace, bmiStandard: f.bmiStandard,
  };
  return {
    errors,
    value: {
      ...base,
      name: f.name.trim() === "" ? null : f.name.trim(),
      activityTrackingMode: f.trackingMode,
      ...(exerciseAddbackPct !== undefined ? { exerciseAddbackPct } : {}),
      ...(maxHr !== undefined ? { maxHr } : {}),
    },
  };
}
