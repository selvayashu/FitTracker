import { useState } from "react";
import { useSession } from "@/lib/session";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import { useInstallPrompt } from "@/lib/pwa";
import { Banner, cardCls, secondaryBtn } from "./ui";
import {
  IOS_HINT, WEEKLY_EMAIL_COPY, WEEKLY_EMAIL_SETUP_NOTE, installResultText, installView, lastSentText, weeklyToggleError,
} from "./settingsCardsLogic";

export function WeeklyEmailCard() {
  const { user } = useSession();
  const { profile, refresh } = useProfile();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = optimistic ?? profile?.email_weekly ?? false;
  const last = lastSentText(profile?.last_weekly_email_at);

  const toggle = async (next: boolean) => {
    if (!user || saving) return;
    setSaving(true);
    setError(null);
    setOptimistic(next);
    try {
      const { error: e } = await supabase.from("profiles").update({ email_weekly: next }).eq("user_id", user.id);
      if (e) throw new Error(e.message);
      await refresh();
      setOptimistic(null);
    } catch (err) {
      setOptimistic(null); // roll back to the stored value
      setError(weeklyToggleError(err, next));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Weekly summary email" className={cardCls}>
      <label className="flex cursor-pointer items-start justify-between gap-3">
        <span className="min-w-0 font-medium">Weekly summary email</span>
        <input type="checkbox" role="switch" className="mt-1 h-5 w-5 shrink-0 accent-teal-600" checked={on} disabled={saving || !user}
          aria-describedby="weekly-email-desc" onChange={(e) => void toggle(e.target.checked)} />
      </label>
      <p id="weekly-email-desc" className="mt-1 text-sm text-slate-600 dark:text-slate-300">{WEEKLY_EMAIL_COPY}</p>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{WEEKLY_EMAIL_SETUP_NOTE}</p>
      {last && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{last}</p>}
      {error && <div className="mt-2"><Banner kind="error">{error}</Banner></div>}
    </section>
  );
}

export function InstallCard() {
  const pwa = useInstallPrompt();
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const view = installView(pwa);
  if (view === "none") return null;

  const doInstall = async () => {
    setBusy(true);
    try {
      setResult(installResultText(await pwa.install()));
    } catch {
      setResult(installResultText("unavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Install app" className={cardCls}>
      <h2 className="font-medium">Install app</h2>
      {view === "button" && (
        <>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Add FitTrack to your device for quick access, even offline.</p>
          <button type="button" className={`${secondaryBtn} mt-3 w-full`} disabled={busy} onClick={() => void doInstall()}>Install FitTrack</button>
        </>
      )}
      {view === "ios" && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{IOS_HINT}.</p>}
      {view === "installed" && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Installed</p>}
      {result && <p role="status" className="mt-2 text-sm text-slate-600 dark:text-slate-300">{result}</p>}
    </section>
  );
}
