import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { bmi as calcBmi } from "@fittrack/shared";
import { useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile";
import { istToday } from "@/lib/time";
import { startStravaConnect } from "@/lib/strava";
import { ErrorState, Spinner } from "@/components/States";
import { Disclaimer } from "@/components/Disclaimer";
import { emptyForm, formFromProfile, parseProfileForm, type FormErrors, type ProfileFormState } from "./formModel";
import { ProfileFields, ProfilePreview } from "./ProfileFields";
import { buildProfileUpdate } from "./saveProfile";
import { persistProfile, upsertWeightLog } from "./persist";
import { Banner, primaryBtn, secondaryBtn } from "./ui";

export function OnboardingPage() {
  const { user } = useSession();
  const { profile, loading, error, refresh } = useProfile();
  const navigate = useNavigate();
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [connectFailed, setConnectFailed] = useState(false);

  if (loading) return <Spinner label="Loading your profile" />;
  if (error) return <ErrorState message={`Could not load your profile: ${error}`} onRetry={() => void refresh()} />;

  // Initialise once the profile has loaded (it may hold partial data from an earlier visit).
  const f = form ?? (profile ? formFromProfile(profile) : emptyForm);
  const update: Dispatch<SetStateAction<ProfileFormState>> = (v) => setForm((prev) => (typeof v === "function" ? v(prev ?? f) : v));

  const next = (e: FormEvent) => {
    e.preventDefault();
    const r = parseProfileForm(f);
    setErrors(r.errors);
    if (r.value) setStep(2);
  };

  const finish = async (mode: "manual" | "strava") => {
    const r = parseProfileForm(f);
    setErrors(r.errors);
    if (!r.value || !user) { setStep(1); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await persistProfile(user.id, buildProfileUpdate({ ...r.value, activityTrackingMode: mode }, profile?.max_hr ?? null));
      await upsertWeightLog(user.id, istToday(), r.value.weightKg, calcBmi(r.value.weightKg, r.value.heightCm));
      await refresh();
      if (mode === "strava") {
        try {
          await startStravaConnect(); // leaves the app for Strava; we come back on /settings?strava=...
          return;
        } catch {
          // Worker not reachable (for example not deployed): fall back to manual tracking so the app stays usable.
          await persistProfile(user.id, buildProfileUpdate({ ...r.value, activityTrackingMode: "manual" }, profile?.max_hr ?? null));
          await refresh();
          setConnectFailed(true);
          return;
        }
      }
      navigate("/", { replace: true });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-10">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-teal-700 dark:text-teal-400">Step {step} of 2</p>
        <h1 className="text-xl font-semibold">{step === 1 ? "Tell us about you" : "How will you track activity?"}</h1>
        {step === 1 && <p className="text-sm text-slate-500 dark:text-slate-400">We use this to estimate your BMI and daily calorie target.</p>}
      </header>

      {step === 1 ? (
        <form onSubmit={next} className="space-y-4" noValidate>
          <ProfileFields form={f} setForm={update} errors={errors} />
          <ProfilePreview form={f} />
          <button type="submit" className={primaryBtn}>Continue</button>
        </form>
      ) : (
        <div className="space-y-3">
          {connectFailed ? (
            <>
              <Banner kind="warn">
                We could not reach Strava just now, so your profile is saved with manual activity entry. You can connect Strava later from Settings.
              </Banner>
              <button type="button" className={primaryBtn} onClick={() => navigate("/", { replace: true })}>Continue</button>
            </>
          ) : (
            <>
              <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <p className="font-medium">Connect Strava</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Import runs, rides and workouts automatically, with heart rate and calories. You will sign in on Strava, then return here.
                </p>
                <button type="button" disabled={saving} onClick={() => void finish("strava")} className={`${secondaryBtn} mt-3 w-full`}>
                  {saving ? "Saving..." : "Connect Strava"}
                </button>
              </div>
              <button
                type="button" disabled={saving}
                onClick={() => void finish("manual")}
                className={primaryBtn}
              >{saving ? "Saving..." : "Enter manually"}</button>
              <button type="button" className="w-full text-sm underline" disabled={saving} onClick={() => setStep(1)}>Back</button>
            </>
          )}
          {saveError && <Banner kind="error">{saveError}</Banner>}
        </div>
      )}
      <Disclaimer />
    </main>
  );

}
