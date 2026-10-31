import { useRegisterSW } from "virtual:pwa-register/react";

const HOUR = 60 * 60 * 1000;

/** Service-worker status: "ready to work offline" once, and an "update available" prompt that never reloads on its own. */
export function PwaPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Check for a new version hourly while the app stays open.
      // Skip while offline, and never let a failed check surface as an unhandled rejection.
      if (registration) setInterval(() => { if (navigator.onLine) registration.update().catch(() => {}); }, HOUR);
    },
  });

  if (!offlineReady && !needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-16 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
      <span>{needRefresh ? "A new version of FitTrack is ready." : "FitTrack is ready to work offline."}</span>
      <span className="flex shrink-0 gap-2">
        {needRefresh && (
          <button className="rounded-lg bg-teal-500 px-3 py-1 font-semibold text-slate-900" onClick={() => void updateServiceWorker(true)}>Reload</button>
        )}
        <button className="rounded-lg px-2 py-1 underline" onClick={() => { setOfflineReady(false); setNeedRefresh(false); }}>
          {needRefresh ? "Later" : "OK"}
        </button>
      </span>
    </div>
  );
}
