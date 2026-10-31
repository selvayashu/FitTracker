import { describe, expect, it } from "vitest";
import { addDaysIst, formatDuration, istDateOf, istTimeOf, parseDuration, toUtcIso } from "./time";

describe("IST helpers", () => {
  it("rolls the IST day over at 18:30 UTC", () => {
    expect(istDateOf("2026-03-05T18:29:00Z")).toBe("2026-03-05");
    expect(istDateOf("2026-03-05T18:30:00Z")).toBe("2026-03-06");
  });
  it("converts IST local time to UTC", () => {
    expect(toUtcIso("2026-03-06", "00:15")).toBe("2026-03-05T18:45:00.000Z");
    expect(toUtcIso("2026-03-06", "06:30")).toBe("2026-03-06T01:00:00.000Z");
  });
  it("round-trips date and time", () => {
    const iso = toUtcIso("2026-03-06", "23:45");
    expect(istDateOf(iso)).toBe("2026-03-06");
    expect(istTimeOf(iso)).toBe("23:45");
  });
  it("shifts dates across month and year ends", () => {
    expect(addDaysIst("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIst("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("parses durations", () => {
    expect(parseDuration("01:30")).toBe(90);
    expect(parseDuration("0:45")).toBe(45);
    expect(parseDuration("1:75")).toBe(0);
    expect(parseDuration("abc")).toBe(0);
    expect(formatDuration(95)).toBe("01:35");
  });
});
