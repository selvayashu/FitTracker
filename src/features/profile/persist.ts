import { supabase } from "@/lib/supabase";
import type { buildProfileUpdate, DerivedColumns } from "./saveProfile";

type ProfileUpdate = ReturnType<typeof buildProfileUpdate> | (Partial<DerivedColumns> & { weight_kg: number });

/** Write profile columns for the signed-in user. Throws an Error with a readable message on failure. */
export async function persistProfile(userId: string, update: ProfileUpdate): Promise<void> {
  const { error } = await supabase.from("profiles").upsert({ user_id: userId, ...update }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

/** Upsert a weight log (one per day). */
export async function upsertWeightLog(userId: string, date: string, weightKg: number, bmiValue: number): Promise<void> {
  const { error } = await supabase.from("weight_logs").upsert(
    { user_id: userId, date, weight_kg: weightKg, bmi: bmiValue },
    { onConflict: "user_id,date" },
  );
  if (error) throw new Error(error.message);
}
