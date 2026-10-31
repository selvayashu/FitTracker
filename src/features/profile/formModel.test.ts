import { describe, expect, it } from "vitest";
import { emptyForm, parseProfileForm, type ProfileFormState } from "./formModel";

const now = new Date("2026-06-01T00:00:00Z");
const ok: ProfileFormState = {
  ...emptyForm, name: "Asha", dob: "1996-06-01", sex: "female", heightCm: "165", weight: "70", target: "62", activity: "light", goal: "lose",
};

describe("parseProfileForm", () => {
  it("accepts a valid form", () => {
    const r = parseProfileForm(ok, { now });
    expect(r.errors).toEqual({});
    expect(r.value?.heightCm).toBe(165);
  });
  it("converts ft/in", () => {
    const r = parseProfileForm({ ...ok, heightUnit: "ftin", ft: "5", inch: "5" }, { now });
    expect(r.value?.heightCm).toBe(165.1);
  });
  it("rejects out of range height and weight", () => {
    const r = parseProfileForm({ ...ok, heightCm: "90", weight: "10" }, { now });
    expect(r.errors.heightCm).toBeDefined();
    expect(r.errors.weight).toBeDefined();
    expect(r.value).toBeNull();
  });
  it("rejects a target that does not suit the goal", () => {
    expect(parseProfileForm({ ...ok, target: "75" }, { now }).errors.target).toBeDefined();
    expect(parseProfileForm({ ...ok, goal: "gain", target: "60" }, { now }).errors.target).toBeDefined();
    expect(parseProfileForm({ ...ok, goal: "maintain", target: "70" }, { now }).errors.target).toBeUndefined();
  });
  it("rejects ages outside 12-100", () => {
    expect(parseProfileForm({ ...ok, dob: "2020-01-01" }, { now }).errors.dob).toBeDefined();
    expect(parseProfileForm({ ...ok, dob: "1900-01-01" }, { now }).errors.dob).toBeDefined();
    expect(parseProfileForm({ ...ok, dob: "2030-01-01" }, { now }).errors.dob).toBeDefined();
  });
  it("validates settings-only fields", () => {
    const r = parseProfileForm({ ...ok, addback: "150", maxHr: "90" }, { now, settings: true });
    expect(r.errors.addback).toBeDefined();
    expect(r.errors.maxHr).toBeDefined();
    const good = parseProfileForm({ ...ok, addback: "40", maxHr: "185" }, { now, settings: true });
    expect(good.value?.exerciseAddbackPct).toBe(40);
    expect(good.value?.maxHr).toBe(185);
  });
});
