import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { bmi as calcBmi } from "@fittrack/shared";
import { istToday } from "@/lib/time";
import { useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { Disclaimer } from "@/components/Disclaimer";
import { ErrorState, Spinner } from "@/components/States";
import { formFromProfile, parseProfileForm, type FormErrors, type ProfileFormState } from "./formModel";
import { ProfileFields, ProfilePreview } from "./ProfileFields";
import { buildProfileUpdate } from "./saveProfile";
import { persistProfile, upsertWeightLog } from "./persist";
import { Banner, primaryBtn, secondaryBtn } from "./ui";

export function SettingsPage() {
  const { user } = useSession();
  const { profile, loading, error, refresh } = useProfile();
  const navigate = useNavigate();
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (loading) return <Spinner label="Loading settings" />;
  if (error) return <ErrorState message={`Could not load your profile: ${error}`} onRetry={() => void refresh()} />;

  const f = form ?? formFromProfile(profile);
  const update: Dispatch<SetStateAction<ProfileFormState>> = (v) => { setMsg(null); setForm((prev) => (typeof v === "function" ? v(prev ?? f) : v)); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const r = parseProfileForm(f, { settings: true });
    setErrors(r.errors);
    if (!r.value || !user) return;
    setSaving(true);
    setMsg(null);
    try {
      await persistProfile(user.id, buildProfileUpdate(r.value, profile?.max_hr ?? null));
      // Keep the weight history in step with the profile so Home, Weight and the trend agree.
      if (profile?.weight_kg !== r.value.weightKg) {
        await upsertWeightLog(user.id, istToday(), r.value.weightKg, calcBmi(r.value.weightKg, r.value.heightCm));
      }
      await refresh();
      setForm(null);
      setMsg({ kind: "success", text: "Targets recalculated" });
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "Could not save settings." });
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <h1 className="text-xl font-semibold">Settings</h1>
      <form onSubmit={save} className="space-y-4" noValidate>
        <ProfileFields form={f} setForm={update} errors={errors} settings />

        <fieldset>
          <legend className="mb-1 text-sm font-medium">How do you track activity?</legend>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="tracking" checked={f.trackingMode === "manual"} onChange={() => update((p) => ({ ...p, trackingMode: "manual" }))} />
              Enter manually
            </label>
            <label className="flex items-center gap-2 text-sm opacity-60">
              <input type="radio" name="tracking" disabled checked={f.trackingMode === "strava"} readOnly />
              Strava <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">Coming in Phase 2</span>
            </label>
          </div>
        </fieldset>

        <ProfilePreview form={f} />
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
        <button type="submit" disabled={saving} className={primaryBtn}>{saving ? "Saving..." : "Save changes"}</button>
      </form>

      <section className="border-t border-slate-200 pt-4 dark:border-slate-700">
        {user?.email && <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">Signed in as {user.email}</p>}
        <button type="button" onClick={() => void signOut()} className={`${secondaryBtn} w-full`}>Sign out</button>
      </section>
      <Disclaimer />
    </main>
  );
}
