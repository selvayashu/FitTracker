import { describe, expect, it } from "vitest";
import { connectionCards, isStravaUnavailable, stravaAvailability } from "./logic";

describe("isStravaUnavailable", () => {
  it.each([
    ["Could not find the function public.strava_status() in the schema cache", true],
    ["function public.strava_status() does not exist", true],
    ["not_configured", true],
    ["Network request failed", false],
    ["JWT expired", false],
    [null, false],
  ])("%s -> %s", (msg, expected) => expect(isStravaUnavailable(msg)).toBe(expected));
});

describe("stravaAvailability", () => {
  const base = { enabled: true, statusLoading: false, statusError: null, connected: false };
  it("states", () => {
    expect(stravaAvailability(base)).toBe("available");
    expect(stravaAvailability({ ...base, statusLoading: true })).toBe("checking");
    expect(stravaAvailability({ ...base, enabled: false, statusLoading: true })).toBe("available");
    expect(stravaAvailability({ ...base, statusError: "function strava_status does not exist" })).toBe("unavailable");
    expect(stravaAvailability({ ...base, statusError: "timeout" })).toBe("available");
  });
});

describe("connectionCards", () => {
  it("lists three cards, each stating needs and availability", () => {
    const cards = connectionCards("unavailable");
    expect(cards.map((c) => c.id)).toEqual(["strava", "file", "manual"]);
    for (const c of cards) { expect(c.needs.length).toBeGreaterThan(0); expect(c.availabilityText.length).toBeGreaterThan(0); }
    expect(cards[0].availabilityText).toMatch(/Not set up/);
  });
});
