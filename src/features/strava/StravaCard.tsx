import { useState } from "react";
import { startStravaConnect, StravaApiError } from "@/lib/strava";
import { Spinner } from "@/components/States";
import { Banner, cardCls, primaryBtn, secondaryBtn } from "@/features/profile/ui";
import { formatCountdown, lastSyncText, mapStravaError, needsReconnect, progressText } from "./logic";
import type { UseStrava } from "./useStrava";

/** Settings card: status, connect, sync now, disconnect (with an opt-in to delete synced activities). */
export function StravaCard({ strava }: { strava: UseStrava }) {
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [alsoDelete, setAlsoDelete] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const { status, statusLoading, statusError, phase, error } = strava;
  const busy = phase === "syncing" || phase === "waiting";

  const connect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      await startStravaConnect();
    } catch (e) {
      setConnectError(e instanceof StravaApiError ? mapStravaError(e.code, e.message).message.replace("Strava sync failed: ", "Could not start the Strava connection: ")
        : "Could not start the Strava connection. You can keep entering activities manually.");
      setConnecting(false);
    }
  };

  const doDisconnect = async () => {
    setDisconnectError(null);
    const err = await strava.disconnect(alsoDelete);
    if (err) setDisconnectError(err);
    else { setConfirming(false); setAlsoDelete(false); }
  };

  return (
    <section aria-label="Strava" className={`${cardCls} space-y-3`}>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Strava</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs ${status?.connected ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100" : "bg-slate-200 dark:bg-slate-700"}`}>
          {status?.connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {statusLoading && !status ? <Spinner label="Checking Strava" /> : statusError && !status ? (
        <div className="space-y-2">
          <Banner kind="error">Could not check your Strava connection: {statusError}</Banner>
          <button type="button" className={secondaryBtn} onClick={() => void strava.refresh()}>Try again</button>
        </div>
      ) : status?.connected ? (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Connected{status.athlete_id ? ` as athlete ${status.athlete_id}` : ""}. {lastSyncText(status.last_sync_at)}.
          </p>
          {busy && (
            <div role="status" className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900">
              {phase === "waiting"
                ? <p>Strava rate limit reached. Retrying in <b>{formatCountdown(strava.countdownSec)}</b>.</p>
                : <p>Syncing...</p>}
              <p className="text-xs text-slate-500 dark:text-slate-400">{progressText(strava)}</p>
            </div>
          )}
          {phase === "error" && error && (
            <Banner kind="error">
              {error.message}
              {needsReconnect(error) && (
                <button type="button" onClick={() => void connect()} className="ml-2 underline">Connect Strava</button>
              )}
            </Banner>
          )}
          {phase === "idle" && strava.processed > 0 && <Banner kind="success">{progressText(strava)}. Sync complete.</Banner>}
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void strava.syncNow()}>
            {busy ? "Syncing..." : "Sync now"}
          </button>

          {!confirming ? (
            <button type="button" className={`${secondaryBtn} w-full`} disabled={strava.disconnecting} onClick={() => setConfirming(true)}>
              Disconnect Strava
            </button>
          ) : (
            <div role="group" aria-label="Confirm disconnect" className="space-y-2 rounded-lg border border-red-300 p-3 dark:border-red-800">
              <p className="text-sm">Disconnect Strava? Your synced activities stay unless you choose to delete them.</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={alsoDelete} onChange={(e) => setAlsoDelete(e.target.checked)} />
                Also delete synced activities
              </label>
              {disconnectError && <Banner kind="error">{disconnectError}</Banner>}
              <div className="flex gap-2">
                <button type="button" disabled={strava.disconnecting} onClick={() => void doDisconnect()}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {strava.disconnecting ? "Disconnecting..." : "Disconnect"}
                </button>
                <button type="button" disabled={strava.disconnecting} onClick={() => { setConfirming(false); setDisconnectError(null); }}
                  className={`${secondaryBtn} flex-1 py-2 text-sm`}>Cancel</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Connect Strava to import your runs, rides and workouts, including heart rate and calories. You can still add activities by hand.
          </p>
          {connectError && <Banner kind="error">{connectError}</Banner>}
          <button type="button" className={primaryBtn} disabled={connecting} onClick={() => void connect()}>
            {connecting ? "Opening Strava..." : "Connect Strava"}
          </button>
        </>
      )}
    </section>
  );
}
