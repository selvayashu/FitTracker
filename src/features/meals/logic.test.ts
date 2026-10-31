import { describe, expect, it } from "vitest";
import type { MealEntryRow } from "@/lib/database.types";
import {
  buildEntry, copyEntries, favouriteFromEntries, cloneItems, mapOffProduct, mapOffResponse, matchRank, mergeDay,
  rankFoods, rescaleEntry, resolveGrams, slotTotals, sumEntries, validateCustomFood, validateQuantity, escapeLike,
  type FoodItem,
} from "./logic";

const rice: FoodItem = {
  source: "food", food_id: 7, custom_food_id: null, external_ref: null, name: "Rice, cooked",
  per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fibre: 0.4 },
  serving_label: "1 katori", serving_g: 150, unit_grams: { katori: 150, piece: 40 },
};

const entry = (over: Partial<MealEntryRow> = {}): MealEntryRow => ({
  id: "a", user_id: "u", date: "2026-03-01", meal_type: "lunch", food_id: 7, custom_food_id: null, external_ref: null,
  food_name: "Rice", quantity: 1, unit: "katori", grams: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.5,
  created_at: "2026-03-01T06:00:00.000Z", ...over,
});

describe("OFF mapping", () => {
  it("maps a full product", () => {
    const f = mapOffProduct({
      code: "890", product_name: " Oats ", brands: "Acme, Other",
      nutriments: { "energy-kcal_100g": 380.4, proteins_100g: 13, carbohydrates_100g: 67, fat_100g: 7, fiber_100g: 10 },
    })!;
    expect(f.external_ref).toBe("off:890");
    expect(f.food_id).toBeNull();
    expect(f.custom_food_id).toBeNull();
    expect(f.name).toBe("Oats");
    expect(f.brand).toBe("Acme");
    expect(f.per100).toEqual({ kcal: 380, protein: 13, carbs: 67, fat: 7, fibre: 10 });
  });
  it("defaults missing macros to 0 but skips products without kcal", () => {
    const f = mapOffProduct({ code: "1", product_name: "X", nutriments: { "energy-kcal_100g": "50" } })!;
    expect(f.per100).toEqual({ kcal: 50, protein: 0, carbs: 0, fat: 0, fibre: 0 });
    expect(mapOffProduct({ code: "1", product_name: "X", nutriments: { proteins_100g: 3 } })).toBeNull();
    expect(mapOffProduct({ code: "1", product_name: "X" })).toBeNull();
    expect(mapOffProduct({ product_name: "X", nutriments: { "energy-kcal_100g": 5 } })).toBeNull();
    expect(mapOffProduct({ code: "1", nutriments: { "energy-kcal_100g": 5 } })).toBeNull();
  });
  it("handles junk responses", () => {
    expect(mapOffResponse(null)).toEqual([]);
    expect(mapOffResponse({})).toEqual([]);
    expect(mapOffResponse({ products: [{ code: "1", product_name: "A", nutriments: { "energy-kcal_100g": 1 } }, {}] })).toHaveLength(1);
  });
});

describe("grams and nutrition per unit", () => {
  const cases: Array<[Parameters<typeof resolveGrams>[2], number]> = [
    ["g", 200], ["ml", 200], ["tbsp", 3000], ["cup", 48000 / 100], ["plate", 500], ["katori", 300], ["piece", 80], ["serving", 300],
  ];
  it.each(cases)("unit %s", (unit, expectedPerTwo) => {
    const qty = unit === "g" || unit === "ml" ? 200 : 2;
    const expected = unit === "tbsp" ? 30 : unit === "cup" ? 480 : expectedPerTwo;
    expect(resolveGrams(rice, qty, unit)).toBe(expected);
    const e = buildEntry({ id: "x", userId: "u", date: "d", meal: "lunch", food: rice, quantity: qty, unit, createdAt: "t" });
    expect(e.grams).toBe(expected);
    expect(e.kcal).toBe(Math.round((130 * expected) / 100));
    expect(e.unit).toBe(unit);
  });
  it("builds a snapshot", () => {
    const e = buildEntry({ id: "x", userId: "u", date: "2026-03-01", meal: "dinner", food: rice, quantity: 1.5, unit: "katori", createdAt: "t" });
    expect(e).toMatchObject({ food_id: 7, food_name: "Rice, cooked", quantity: 1.5, grams: 225, kcal: 293, meal_type: "dinner", date: "2026-03-01" });
  });
  it("validates quantity", () => {
    expect(validateQuantity(rice, 0, "g")).not.toBeNull();
    expect(validateQuantity(rice, -1, "g")).not.toBeNull();
    expect(validateQuantity(rice, NaN, "g")).not.toBeNull();
    expect(validateQuantity(rice, 10001, "g")).not.toBeNull();
    expect(validateQuantity(rice, 100, "plate")).not.toBeNull();
    expect(validateQuantity(rice, 0.5, "g")).toBeNull();
  });
  it("rescales an entry proportionally", () => {
    const r = rescaleEntry(entry(), 2);
    expect(r).toMatchObject({ quantity: 2, grams: 300, kcal: 390, protein: 8, carbs: 84, fat: 1 });
  });
});

describe("totals", () => {
  const list = [
    entry({ id: "1", meal_type: "breakfast", kcal: 100, protein: 5.1, carbs: 10, fat: 1 }),
    entry({ id: "2", meal_type: "breakfast", kcal: 50, protein: 1.2, carbs: 5.5, fat: 0.5 }),
    entry({ id: "3", meal_type: "dinner", kcal: 300, protein: 20, carbs: 30, fat: 10 }),
  ];
  it("sums across slots", () => {
    expect(sumEntries(list)).toEqual({ kcal: 450, protein: 26.3, carbs: 45.5, fat: 11.5 });
    expect(sumEntries([])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
  });
  it("sums per slot", () => {
    const s = slotTotals(list);
    expect(s.breakfast.kcal).toBe(150);
    expect(s.lunch.kcal).toBe(0);
    expect(s.snack.kcal).toBe(0);
    expect(s.dinner.kcal).toBe(300);
  });
});

describe("copy yesterday", () => {
  const src = [entry({ id: "a", meal_type: "lunch" }), entry({ id: "b", meal_type: "dinner", kcal: 400 })];
  let n = 0;
  const opts = { userId: "u2", toDate: "2026-03-02", newId: () => `new-${++n}`, now: "2026-03-02T01:00:00.000Z" };
  it("gives new ids, new date, same nutrition", () => {
    const out = copyEntries(src, opts);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.id)).toEqual(["new-1", "new-2"]);
    expect(out.every((e) => e.date === "2026-03-02" && e.user_id === "u2")).toBe(true);
    expect(out[1]).toMatchObject({ kcal: 400, meal_type: "dinner", grams: 150, food_name: "Rice" });
    expect(sumEntries(out)).toEqual(sumEntries(src));
    expect(src[0].id).toBe("a");
  });
  it("can copy one slot only", () => {
    const out = copyEntries(src, { ...opts, meal: "dinner" });
    expect(out).toHaveLength(1);
    expect(out[0].meal_type).toBe("dinner");
  });
  it("returns empty for an empty day", () => {
    expect(copyEntries([], opts)).toEqual([]);
  });
});

describe("favourites", () => {
  it("snapshots a slot and clones it into another slot", () => {
    const list = [entry({ id: "a", meal_type: "lunch" }), entry({ id: "b", meal_type: "dinner" })];
    const fav = favouriteFromEntries(list, { id: "f", userId: "u", name: " My lunch ", meal: "lunch", now: "t" });
    expect(fav.name).toBe("My lunch");
    expect(fav.items).toHaveLength(1);
    expect(fav.items[0]).not.toHaveProperty("id");
    let n = 0;
    const rows = cloneItems(fav.items, { userId: "u", date: "2026-03-05", meal: "snack", newId: () => `c${++n}`, now: "t2" });
    expect(rows[0]).toMatchObject({ id: "c1", meal_type: "snack", date: "2026-03-05", kcal: 195 });
  });
});

describe("search helpers", () => {
  it("ranks by match quality", () => {
    expect(matchRank("Rice", "rice")).toBe(0);
    expect(matchRank("Rice, cooked", "rice")).toBe(1);
    expect(matchRank("Fried rice", "rice")).toBe(2);
    expect(matchRank("Licorice", "rice")).toBe(3);
    expect(matchRank("Dal", "rice")).toBe(4);
    const ranked = rankFoods([{ name: "Fried rice" }, { name: "Licorice" }, { name: "Rice" }], "rice");
    expect(ranked.map((r) => r.name)).toEqual(["Rice", "Fried rice", "Licorice"]);
  });
  it("escapes ilike and filter characters", () => {
    expect(escapeLike(" 100%_a,b(c) ")).toBe("100\\%\\_a b c");
  });
});

describe("custom food validation", () => {
  const ok = { name: "Mine", kcal: "200", protein: "5", carbs: "", fat: "2", fibre: "1", servingLabel: "", servingG: "" };
  it("accepts and defaults", () => {
    const r = validateCustomFood(ok);
    expect(r.error).toBeNull();
    expect(r.values).toMatchObject({ kcal_per_100g: 200, carbs_per_100g: 0, serving_label: "1 serving", serving_g: 100 });
  });
  it("rejects bad input", () => {
    expect(validateCustomFood({ ...ok, name: " " }).error).toMatch(/name/i);
    expect(validateCustomFood({ ...ok, kcal: "901" }).error).toMatch(/900/);
    expect(validateCustomFood({ ...ok, kcal: "" }).error).not.toBeNull();
    expect(validateCustomFood({ ...ok, protein: "-1" }).error).not.toBeNull();
    expect(validateCustomFood({ ...ok, servingG: "0" }).error).not.toBeNull();
  });
});

describe("mergeDay", () => {
  const s1 = entry({ id: "s1", created_at: "2026-03-01T01:00:00Z" });
  const s2 = entry({ id: "s2", created_at: "2026-03-01T02:00:00Z" });
  const l3 = entry({ id: "l3", created_at: "2026-03-01T03:00:00Z" });
  it("server wins with nothing pending", () => {
    expect(mergeDay([s1], [l3], ["s1"], false)).toEqual([s1]);
  });
  it("keeps local adds, edits and deletes while pending", () => {
    const edited = { ...s2, quantity: 3 };
    const out = mergeDay([s1, s2], [edited, l3], ["s1"], true);
    expect(out.map((e) => e.id)).toEqual(["s2", "l3"]);
    expect(out[0].quantity).toBe(3);
  });
});
