/** Pure logic for the Connections screen. */

export const STRAVA_UNAVAILABLE_TEXT =
  "Strava is not set up on this server yet. Connecting needs a Strava developer app, and Strava requires a subscription to create one. You can bring your workouts in with a file instead.";

/**
 * True when a Strava status error means "Strava is not available on this server": the server reports `not_configured`,
 * or the database has no `strava_status` function yet (PostgREST PGRST202 / Postgres 42883 / "could not find the function").
 */
export function isStravaUnavailable(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  if (m.includes("not_configured")) return true;
  const mentionsFn = m.includes("strava_status");
  const missing = m.includes("could not find the function") || m.includes("does not exist") || m.includes("pgrst202") || m.includes("42883")
    || m.includes("schema cache");
  return mentionsFn && missing || (missing && m.includes("function"));
}

export type CardAvailability = "available" | "unavailable" | "checking";

export interface ConnectionCard {
  id: "strava" | "file" | "manual";
  title: string;
  needs: string;
  availability: CardAvailability;
  availabilityText: string;
}

export function stravaAvailability(a: { enabled: boolean; statusLoading: boolean; statusError: string | null; connected: boolean }): CardAvailability {
  if (isStravaUnavailable(a.statusError)) return "unavailable";
  if (a.enabled && a.statusLoading && !a.connected) return "checking";
  return "available";
}

export function connectionCards(strava: CardAvailability): ConnectionCard[] {
  return [
    {
      id: "strava", title: "Strava", availability: strava,
      needs: "A Strava account, and a Strava developer app set up on this server.",
      availabilityText: strava === "unavailable" ? "Not set up on this server yet." : strava === "checking" ? "Checking..." : "Available to try.",
    },
    {
      id: "file", title: "Import an activity file (GPX/TCX)", availability: "available",
      needs: "A .gpx or .tcx file exported from your watch app, and an internet connection to save.",
      availabilityText: "Available.",
    },
    {
      id: "manual", title: "Add by hand", availability: "available",
      needs: "Nothing. Works offline.",
      availabilityText: "Available.",
    },
  ];
}
