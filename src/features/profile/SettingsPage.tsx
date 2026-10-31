import { useEffect, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { bmi as calcBmi } from "@fittrack/shared";
import { istToday } from "@/lib/time";
import { useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { startStravaConnect } from "@/lib/strava";
import { StravaCard, mapReturnReason, parseReturnParams, stripReturnParams, useStrava } from "@/features/strava";
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
  const [returned] = useState(() => parseReturnParams(window.location.search));
  const [returnBanner, setReturnBanner] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const handledReturn = useRef(false);
  const strava = useStrava({ enabled: profile?.activity_tracking_mode === "strava" || returned?.kind === "connected" });

  // Back from Strava: wait for the signed-in user (the store binds to it), show the outcome, refresh status, start the
  // first sync, and clear the query string only after that handling has run.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!returned || handledReturn.current || !userId) return;
    handledReturn.current = true;
    const clearQuery = () => {
      const search = stripReturnParams(window.location.search);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${search}${window.location.hash}`);
    };
    if (returned.kind === "error") {
      setReturnBanner({ kind: "error", text: mapReturnReason(returned.reason) });
      clearQuery();
      return;
    }
    setReturnBanner({ kind: "success", text: "Strava connected. Importing your last 90 days of activities..." });
    void (async () => {
      try {
        await strava.refresh();
        await refresh();
        await strava.syncNow("initial");
      } finally {
        clearQuery();
      }
    })();
    // Runs once per page visit once the user is known; the ref guards against StrictMode's double effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
      if (r.value.activityTrackingMode === "strava" && profile?.activity_tracking_mode !== "strava") {
        try {
          await startStravaConnect();
        } catch {
          setMsg({ kind: "error", text: "Saved, but we could not reach Strava to start the connection. Use Connect Strava below to try again." });
        }
      }
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
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="tracking" checked={f.trackingMode === "strava"} onChange={() => update((p) => ({ ...p, trackingMode: "strava" }))} />
              Strava (import automatically)
            </label>
          </div>
          {f.trackingMode === "strava" && profile?.activity_tracking_mode !== "strava" && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Save changes to continue to Strava and connect your account.</p>
          )}
          {f.trackingMode === "manual" && profile?.activity_tracking_mode === "strava" && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Switching to manual stops syncing. Your Strava activities stay in the app.</p>
          )}
        </fieldset>

        <ProfilePreview form={f} />
        {msg && <Banner kind={msg.kind}>{msg.text}</Banner>}
        <button type="submit" disabled={saving} className={primaryBtn}>{saving ? "Saving..." : "Save changes"}</button>
      </form>

      {profile?.activity_tracking_mode === "strava" && (
        <>
          {returnBanner && <Banner kind={returnBanner.kind}>{returnBanner.text}</Banner>}
          <StravaCard strava={strava} />
        </>
      )}
      {profile?.activity_tracking_mode !== "strava" && (
        <section aria-label="Use Strava" className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
          <p className="font-medium">Use Strava instead</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Import your activities automatically instead of typing them in.</p>
          <button type="button" className={`${secondaryBtn} mt-3 w-full`} onClick={() => { setMsg(null); update((p) => ({ ...p, trackingMode: "strava" })); }}>
            Use Strava instead
          </button>
          {returnBanner && <div className="mt-3"><Banner kind={returnBanner.kind}>{returnBanner.text}</Banner></div>}
        </section>
      )}

      <section className="border-t border-slate-200 pt-4 dark:border-slate-700">
        {user?.email && <p className="mb-2 text-sm text-slate-500 dark:text-slate-400">Signed in as {user.email}</p>}
        <button type="button" onClick={() => void signOut()} className={`${secondaryBtn} w-full`}>Sign out</button>
      </section>
      <Disclaimer />
    </main>
  );
}
