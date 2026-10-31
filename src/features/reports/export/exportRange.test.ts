import { describe, expect, it } from "vitest";
import { exportAvailability, sameRange, successMessage } from "./exportLogic";

describe("range match and lossy hint", () => {
  it("disables export when the data is for another range", () => {
    const ok = { loaded: true, loading: false, empty: false, busy: false };
    expect(exportAvailability({ ...ok, rangeMatches: false }).enabled).toBe(false);
    expect(exportAvailability({ ...ok, rangeMatches: true }).enabled).toBe(true);
    expect(sameRange({ from: "a", to: "b" }, { from: "a", to: "b" })).toBe(true);
    expect(sameRange({ from: "a", to: "b" }, { from: "a", to: "c" })).toBe(false);
    expect(sameRange(null, { from: "a", to: "b" })).toBe(false);
  });
  it("adds the hint to the success message", () => {
    expect(successMessage("a.pdf", true)).toContain("preserved in the CSV");
    expect(successMessage("a.pdf")).toBe("Saved a.pdf");
  });
});
