import { describe, expect, it } from "vitest";
import { isIosSafari } from "./pwa";

describe("isIosSafari", () => {
  it("detects iPhone Safari", () => {
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(true);
  });
  it("rejects Chrome and Firefox on iOS (no install prompt either, but different menus)", () => {
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15")).toBe(false);
  });
  it("detects iPad Safari, which reports a Mac user agent, by touch support", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(isIosSafari(ua, 5)).toBe(true);
    expect(isIosSafari(ua, 0)).toBe(false); // a real Mac
  });
  it("rejects Android and desktop", () => {
    expect(isIosSafari("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36")).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36")).toBe(false);
  });
});
