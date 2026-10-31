import { formatIstDateTime } from "@fittrack/shared";

export const WEEKLY_EMAIL_COPY =
  "Get a summary of your previous 7 days every Monday morning (about 8:00 IST). You can switch it off any time, or use the unsubscribe link in the email.";
export const WEEKLY_EMAIL_SETUP_NOTE =
  "Sending needs email to be set up by the app owner (see the \"Weekly summary email\" section of the README). Until then you will not receive anything.";

/** "Last sent: 27 Oct 2026, 08:00 IST", or null when never sent or the value is not a date. */
export function lastSentText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Last sent: ${formatIstDateTime(d)}`;
}

export function weeklyToggleError(err: unknown, next: boolean): string {
  const why = err instanceof Error && err.message ? ` (${err.message})` : "";
  return `Could not ${next ? "turn on" : "turn off"} the weekly summary email${why}. Your setting was not changed.`;
}

export type InstallView = "button" | "ios" | "installed" | "none";

export function installView(s: { canInstall: boolean; installed: boolean; showIosHint: boolean }): InstallView {
  if (s.installed) return "installed";
  if (s.canInstall) return "button";
  if (s.showIosHint) return "ios";
  return "none";
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** Never promises another try unless the browser is offering the install prompt again (`canInstall`). */
export function installResultText(outcome: InstallOutcome, canInstall = false): string {
  if (outcome === "accepted") return "Installing FitTrack. You will find it on your home screen or app list.";
  if (outcome === "dismissed") return canInstall ? "Install cancelled. It will be offered again later." : "Install cancelled.";
  return "Install is not available right now. Use your browser menu to add FitTrack to your home screen.";
}

/** Keep rendering the install card while a result message is pending, even after canInstall flipped off. */
export function installCardVisible(view: InstallView, outcome: InstallOutcome | null): boolean {
  return view !== "none" || outcome !== null;
}

/**
 * The optimistic switch value to keep showing: it is dropped once the stored value agrees with it,
 * or on failure (rollback). While saving, or while the stored value is still stale, it is kept.
 */
export function nextOptimistic(optimistic: boolean | null, stored: boolean, saving: boolean): boolean | null {
  if (optimistic === null || saving) return optimistic;
  return stored === optimistic ? null : optimistic;
}

export const IOS_HINT = "Tap Share, then Add to Home Screen";
