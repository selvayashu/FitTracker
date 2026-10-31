import { describe, expect, it } from "vitest";
import { installResultText, installView, lastSentText, weeklyToggleError } from "./settingsCardsLogic";

describe("lastSentText", () => {
  it("formats in IST", () => {
    expect(lastSentText("2026-10-26T02:30:00Z")).toBe("Last sent: 26 Oct 2026, 08:00 IST");
  });
  it("is null for missing or invalid values", () => {
    expect(lastSentText(null)).toBeNull();
    expect(lastSentText("nope")).toBeNull();
  });
});

describe("installView", () => {
  it("prioritises installed, then button, then iOS hint", () => {
    expect(installView({ canInstall: true, installed: true, showIosHint: false })).toBe("installed");
    expect(installView({ canInstall: true, installed: false, showIosHint: false })).toBe("button");
    expect(installView({ canInstall: false, installed: false, showIosHint: true })).toBe("ios");
    expect(installView({ canInstall: false, installed: false, showIosHint: false })).toBe("none");
  });
  it("describes outcomes", () => {
    expect(installResultText("accepted")).toMatch(/Installing/);
    expect(installResultText("dismissed")).toMatch(/cancelled/);
    expect(installResultText("unavailable")).toMatch(/not available/);
  });
});

describe("weeklyToggleError", () => {
  it("mentions the action and keeps the reason", () => {
    expect(weeklyToggleError(new Error("rls"), true)).toContain("turn on");
    expect(weeklyToggleError("x", false)).toContain("turn off");
  });
});
