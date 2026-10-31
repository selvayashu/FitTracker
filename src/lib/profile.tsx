import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { computeProfileDerived, type ProfileDerived, type ProfileInput } from "@fittrack/shared";
import type { ProfileRow } from "./database.types";
import { supabase } from "./supabase";
import { useSession } from "./session";

interface ProfileState {
  profile: ProfileRow | null;
  /** Derived numbers computed live from the profile with the shared module; null until the profile is complete. */
  derived: ProfileDerived | null;
  loading: boolean;
  error: string | null;
  /** Re-read the profile after a write. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<ProfileState>({ profile: null, derived: null, loading: true, error: null, refresh: async () => {} });

/** Convert a stored profile into the shared module's input, or null when required fields are missing. */
export function toProfileInput(p: ProfileRow | null): ProfileInput | null {
  if (!p || !p.sex || !p.dob || !p.height_cm || !p.weight_kg || !p.target_weight_kg || !p.activity_level || !p.goal || !p.pace) return null;
  return {
    sex: p.sex, dob: p.dob, heightCm: p.height_cm, weightKg: p.weight_kg, targetWeightKg: p.target_weight_kg,
    activityLevel: p.activity_level, goal: p.goal, pace: p.pace, bmiStandard: p.bmi_standard,
  };
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) { setProfile(null); setLoading(false); return; }
    setLoading(true);
    const { data, error: err } = await supabase.from("profiles").select("*").eq("user_id", user.id).maybeSingle();
    setError(err ? err.message : null);
    setProfile((data as ProfileRow | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  const derived = useMemo(() => {
    const input = toProfileInput(profile);
    return input ? computeProfileDerived(input) : null;
  }, [profile]);

  return <Ctx.Provider value={{ profile, derived, loading, error, refresh }}>{children}</Ctx.Provider>;
}

export const useProfile = () => useContext(Ctx);
