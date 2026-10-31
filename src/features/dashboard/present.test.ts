import { describe, expect, it } from "vitest";
import { activeTimeLabel, donutSlices, isStale, percent, ratio, ringGeometry, ringLabel } from "./present";

describe("ratio / percent", () => {
  it("handles zero target, NaN and clamps", () => {
    expect(ratio(10, 0)).toBe(0);
    expect(ratio(NaN, 100)).toBe(0);
    expect(ratio(50, NaN)).toBe(0);
    expect(ratio(-5, 100)).toBe(0);
    expect(ratio(500, 100)).toBe(1);
    expect(percent(50, 200)).toBe(25);
    expect(percent(Infinity, 100)).toBe(0);
  });
});

describe("ringGeometry", () => {
  it("empty, half, exact and over", () => {
    expect(ringGeometry(0, 2000).dashOffset).toBeCloseTo(ringGeometry(0, 2000).circumference);
    expect(ringGeometry(1000, 2000).fraction).toBe(0.5);
    expect(ringGeometry(2000, 2000).dashOffset).toBeCloseTo(0);
    expect(ringGeometry(2500, 2000).fraction).toBe(1);
  });
  it("zero allowance and NaN are safe", () => {
    expect(ringGeometry(0, 0).fraction).toBe(0);
    expect(ringGeometry(100, 0).fraction).toBe(1);
    const g = ringGeometry(NaN, NaN);
    expect(Number.isFinite(g.dashOffset)).toBe(true);
  });
});

describe("ringLabel", () => {
  it("remaining", () => {
    const l = ringLabel(1250, false);
    expect(l.big).toBe("1,250");
    expect(l.caption).toBe("kcal left");
    expect(l.over).toBe(false);
  });
  it("exactly at allowance is zero left, not over", () => {
    const l = ringLabel(0, false);
    expect(l.big).toBe("0");
    expect(l.over).toBe(false);
  });
  it("over shows the positive over amount", () => {
    const l = ringLabel(-300, true);
    expect(l.big).toBe("300");
    expect(l.caption).toBe("kcal over");
    expect(l.aria).toContain("over");
  });
  it("NaN safe", () => {
    expect(ringLabel(NaN, false).big).toBe("0");
  });
});

describe("donutSlices", () => {
  it("returns none without macros", () => {
    expect(donutSlices({ proteinG: 0, carbsG: 0, fatG: 0 })).toEqual([]);
    expect(donutSlices({ proteinG: NaN, carbsG: NaN, fatG: NaN })).toEqual([]);
  });
  it("shares sum to 1 and offsets accumulate", () => {
    const s = donutSlices({ proteinG: 50, carbsG: 100, fatG: 20 });
    expect(s.reduce((a, b) => a + b.share, 0)).toBeCloseTo(1);
    expect(Math.abs(s[0].offset)).toBe(0);
    expect(s[1].offset).toBeCloseTo(-s[0].dash);
    expect(s[2].kcal).toBe(180);
  });
  it("ignores negatives", () => {
    const s = donutSlices({ proteinG: -10, carbsG: 10, fatG: 0 });
    expect(s[0].share).toBe(0);
    expect(s[1].share).toBe(1);
  });
});

describe("isStale", () => {
  it("detects date rollover", () => {
    expect(isStale("2026-03-01", "2026-03-01")).toBe(false);
    expect(isStale("2026-03-01", "2026-03-02")).toBe(true);
    expect(isStale(null, "2026-03-02")).toBe(true);
  });
});

describe("activeTimeLabel", () => {
  it("formats", () => {
    expect(activeTimeLabel(0)).toBe("0 min");
    expect(activeTimeLabel(45)).toBe("45 min");
    expect(activeTimeLabel(65)).toBe("1h 05m");
    expect(activeTimeLabel(NaN)).toBe("0 min");
  });
});
