import { describe, expect, it } from "vitest";
import { errorMessage, exportAvailability, successMessage } from "./exportLogic";

describe("exportAvailability", () => {
  it("is disabled with a hint while loading", () => {
    const a = exportAvailability({ loaded: false, loading: true, empty: false, busy: false });
    expect(a.enabled).toBe(false);
    expect(a.hint).toMatch(/loaded/);
  });
  it("explains an empty range", () => {
    const a = exportAvailability({ loaded: true, loading: false, empty: true, busy: false });
    expect(a).toEqual({ enabled: false, hint: expect.stringMatching(/Nothing to export/) });
  });
  it("is enabled for loaded data, but not while busy", () => {
    expect(exportAvailability({ loaded: true, loading: false, empty: false, busy: false }).enabled).toBe(true);
    expect(exportAvailability({ loaded: true, loading: false, empty: false, busy: true }).enabled).toBe(false);
  });
});

describe("messages", () => {
  it("formats success and error text", () => {
    expect(successMessage("a.pdf")).toBe("Saved a.pdf");
    expect(errorMessage("pdf", new Error("boom"))).toContain("PDF (boom)");
    expect(errorMessage("daily", "x")).toContain("Daily CSV");
  });
});
