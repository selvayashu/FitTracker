import { lazy, Suspense, useState } from "react";
import { Link } from "react-router-dom";
import { Spinner } from "@/components/States";
import { useProfile } from "@/lib/profile";
import { StravaCard, useStrava } from "@/features/strava";
import { Banner, cardCls, primaryBtn, secondaryBtn } from "@/features/profile/ui";
import { STRAVA_UNAVAILABLE_TEXT, connectionCards, stravaAvailability, type ConnectionCard } from "./logic";

const ImportSheet = lazy(() => import("@/features/activity/import").then((m) => ({ default: m.ImportSheet })));

function Needs({ card }: { card: ConnectionCard }) {
  return (
    <dl className="space-y-0.5 text-xs text-slate-500 dark:text-slate-400">
      <div className="flex gap-1"><dt className="font-medium">Needs:</dt><dd>{card.needs}</dd></div>
      <div className="flex gap-1"><dt className="font-medium">Status:</dt><dd>{card.availabilityText}</dd></div>
    </dl>
  );
}

/** Hub listing every way workouts get into FitTrack. */
export function ConnectionsPage() {
  const { profile, loading, error, refresh } = useProfile();
  const strava = useStrava({ enabled: profile?.activity_tracking_mode === "strava" });
  const [importOpen, setImportOpen] = useState(false);

  if (loading && !profile) return <div className="mx-auto max-w-md p-4"><Spinner label="Loading connections" /></div>;

  const availability = stravaAvailability({
    enabled: profile?.activity_tracking_mode === "strava", statusLoading: strava.statusLoading, statusError: strava.statusError, connected: strava.connected,
  });
  const [stravaInfo, fileInfo, manualInfo] = connectionCards(availability);

  return (
    <div className="mx-auto max-w-md space-y-4 p-4 pb-28">
      <h1 className="text-xl font-semibold">Connections</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">Ways to bring your workouts into FitTrack. Pick whatever works for you.</p>
      {error && !profile && (
        <Banner kind="error">
          Could not load your profile: {error}{" "}
          <button type="button" className="underline" onClick={() => void refresh()}>Try again</button>
        </Banner>
      )}

      {availability === "unavailable" ? (
        <section aria-label="Strava" className={`${cardCls} space-y-3`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Strava</h2>
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">Not set up</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">{STRAVA_UNAVAILABLE_TEXT}</p>
          <Needs card={stravaInfo} />
          <button type="button" className={primaryBtn} onClick={() => setImportOpen(true)}>Import a file instead</button>
        </section>
      ) : (
        <div className="space-y-2">
          <StravaCard strava={strava} />
          <div className="px-1"><Needs card={stravaInfo} /></div>
        </div>
      )}

      <section aria-label="Import activity file" className={`${cardCls} space-y-3`}>
        <h2 className="font-semibold">{fileInfo.title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Add workouts exported from a watch app. The file is read on this device and only the summary numbers are saved.
        </p>
        <Needs card={fileInfo} />
        <button type="button" className={primaryBtn} onClick={() => setImportOpen(true)}>Import file</button>
        <details className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <summary className="cursor-pointer font-medium">Getting a file from Zepp (Amazfit) on Android / Garmin / Strava</summary>
          <div className="mt-2 space-y-2 text-slate-600 dark:text-slate-300">
            <p><b>Zepp (Amazfit) on Android:</b> open the Zepp app, open a workout, and look for the Export or Share option. Choose GPX if it is offered.</p>
            <p><b>Garmin Connect:</b> on the website, open the activity, then use the gear menu and choose Export to GPX or Export to TCX.</p>
            <p><b>Strava:</b> on the activity page on the web, open the three-dot menu and choose Export GPX or Export Original.</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Menu names vary by app version, and not every workout type has an export.</p>
          </div>
        </details>
      </section>

      <section aria-label="Add by hand" className={`${cardCls} space-y-3`}>
        <h2 className="font-semibold">{manualInfo.title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">Type in a workout yourself, or repeat one you do often.</p>
        <Needs card={manualInfo} />
        <Link to="/activity" className={`${secondaryBtn} block text-center`}>Open Activity</Link>
      </section>

      {importOpen && (
        <Suspense fallback={<Spinner label="Loading" />}>
          <ImportSheet onClose={() => setImportOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
