import { gramsFor, scaleNutrition, type FoodUnit, type MealType, type Nutrition } from "@fittrack/shared";
import type { CustomFoodRow, FavouriteMealRow, FoodRow, MealEntryRow } from "@/lib/database.types";

export const MEAL_SLOTS: Array<{ type: MealType; label: string }> = [
  { type: "breakfast", label: "Breakfast" },
  { type: "lunch", label: "Lunch" },
  { type: "snack", label: "Evening Snack" },
  { type: "dinner", label: "Dinner" },
];

export const UNITS: FoodUnit[] = ["g", "ml", "piece", "katori", "cup", "plate", "tbsp"];
export type EntryUnit = FoodUnit | "serving";

export const MAX_GRAMS = 10000;
export const MAX_KCAL_PER_100G = 900;

/** A food from any source, normalised for the add flow. */
export interface FoodItem {
  source: "food" | "custom" | "off";
  food_id: number | null;
  custom_food_id: string | null;
  external_ref: string | null;
  name: string;
  brand?: string;
  per100: Nutrition;
  serving_label: string;
  serving_g: number;
  unit_grams: Record<string, number>;
}

export type EntrySnapshot = Pick<
  MealEntryRow,
  "food_id" | "custom_food_id" | "external_ref" | "food_name" | "quantity" | "unit" | "grams" | "kcal" | "protein" | "carbs" | "fat"
>;

export function fromFoodRow(r: FoodRow): FoodItem {
  return {
    source: "food", food_id: r.id, custom_food_id: null, external_ref: null, name: r.name,
    per100: { kcal: r.kcal_per_100g, protein: r.protein_per_100g, carbs: r.carbs_per_100g, fat: r.fat_per_100g, fibre: r.fibre_per_100g },
    serving_label: r.serving_label, serving_g: r.serving_g, unit_grams: r.unit_grams ?? {},
  };
}

export function fromCustomRow(r: CustomFoodRow): FoodItem {
  return {
    source: "custom", food_id: null, custom_food_id: r.id, external_ref: null, name: r.name,
    per100: { kcal: r.kcal_per_100g, protein: r.protein_per_100g, carbs: r.carbs_per_100g, fat: r.fat_per_100g, fibre: r.fibre_per_100g },
    serving_label: r.serving_label, serving_g: r.serving_g, unit_grams: r.unit_grams ?? {},
  };
}

// ---------------------------------------------------------------- Open Food Facts

export interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Maps an OFF product to a FoodItem (per 100 g). Returns null when there is no usable name, code or kcal. */
export function mapOffProduct(p: OffProduct): FoodItem | null {
  const name = p.product_name?.trim();
  const code = p.code?.trim();
  if (!name || !code) return null;
  const n = p.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]);
  if (kcal === null || kcal > MAX_KCAL_PER_100G) return null;
  const brand = p.brands?.split(",")[0]?.trim() || undefined;
  return {
    source: "off", food_id: null, custom_food_id: null, external_ref: `off:${code}`,
    name, brand,
    per100: {
      kcal: Math.round(kcal),
      protein: num(n["proteins_100g"]) ?? 0,
      carbs: num(n["carbohydrates_100g"]) ?? 0,
      fat: num(n["fat_100g"]) ?? 0,
      fibre: num(n["fiber_100g"]) ?? 0,
    },
    serving_label: "100 g", serving_g: 100, unit_grams: {},
  };
}

export function mapOffResponse(json: unknown): FoodItem[] {
  const products = (json as { products?: OffProduct[] } | null)?.products;
  if (!Array.isArray(products)) return [];
  return products.map(mapOffProduct).filter((x): x is FoodItem => x !== null);
}

// ---------------------------------------------------------------- search ranking

/** Lower is better: 0 exact, 1 prefix, 2 word prefix, 3 contains, 4 no match. */
export function matchRank(name: string, query: string): number {
  const n = name.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return 4;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(/[\s,()/-]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 3 : 4;
}

export function rankFoods<T extends { name: string }>(items: T[], query: string): T[] {
  return items
    .map((it, i) => ({ it, i, r: matchRank(it.name, query) }))
    .sort((a, b) => a.r - b.r || a.it.name.length - b.it.name.length || a.i - b.i)
    .map((x) => x.it);
}

/** Escape characters that are special in ilike patterns and in PostgREST filter strings. */
export function escapeLike(q: string): string {
  return q.trim().replace(/[\\%_]/g, (c) => `\\${c}`).replace(/[,()]/g, " ").trim();
}

// ---------------------------------------------------------------- quantity / nutrition

export function resolveGrams(food: FoodItem, quantity: number, unit: EntryUnit): number {
  return gramsFor(quantity, unit, { serving_g: food.serving_g, unit_grams: food.unit_grams });
}

/** Returns an error message, or null when the quantity is acceptable. */
export function validateQuantity(food: FoodItem, quantity: number, unit: EntryUnit): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Enter a quantity greater than 0.";
  const grams = resolveGrams(food, quantity, unit);
  if (grams > MAX_GRAMS) return "That is more than 10,000 g, please check the quantity.";
  return null;
}

export interface NewEntryInput {
  id: string;
  userId: string;
  date: string;
  meal: MealType;
  food: FoodItem;
  quantity: number;
  unit: EntryUnit;
  createdAt: string;
}

export function buildEntry(i: NewEntryInput): MealEntryRow {
  const grams = resolveGrams(i.food, i.quantity, i.unit);
  const n = scaleNutrition(i.food.per100, grams);
  return {
    id: i.id, user_id: i.userId, date: i.date, meal_type: i.meal,
    food_id: i.food.food_id, custom_food_id: i.food.custom_food_id, external_ref: i.food.external_ref,
    food_name: i.food.name, quantity: i.quantity, unit: i.unit, grams,
    kcal: n.kcal, protein: n.protein, carbs: n.carbs, fat: n.fat, created_at: i.createdAt,
  };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** Change an existing entry's quantity; grams and nutrition scale proportionally from the snapshot. */
export function rescaleEntry(e: MealEntryRow, quantity: number): MealEntryRow {
  const f = quantity / e.quantity;
  return {
    ...e, quantity, grams: r1(e.grams * f), kcal: Math.round(e.kcal * f),
    protein: r1(e.protein * f), carbs: r1(e.carbs * f), fat: r1(e.fat * f),
  };
}

export function validateEntryQuantity(e: MealEntryRow, quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Enter a quantity greater than 0.";
  if ((e.grams / e.quantity) * quantity > MAX_GRAMS) return "That is more than 10,000 g, please check the quantity.";
  return null;
}

// ---------------------------------------------------------------- totals

export interface Totals { kcal: number; protein: number; carbs: number; fat: number }

export function sumEntries(entries: Array<Pick<MealEntryRow, "kcal" | "protein" | "carbs" | "fat">>): Totals {
  const t = entries.reduce((a, e) => ({
    kcal: a.kcal + e.kcal, protein: a.protein + e.protein, carbs: a.carbs + e.carbs, fat: a.fat + e.fat,
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  return { kcal: Math.round(t.kcal), protein: r1(t.protein), carbs: r1(t.carbs), fat: r1(t.fat) };
}

export function slotTotals(entries: MealEntryRow[]): Record<MealType, Totals> {
  const out = {} as Record<MealType, Totals>;
  for (const s of MEAL_SLOTS) out[s.type] = sumEntries(entries.filter((e) => e.meal_type === s.type));
  return out;
}

// ---------------------------------------------------------------- copy / favourites

export function snapshotOf(e: EntrySnapshot): EntrySnapshot {
  return {
    food_id: e.food_id, custom_food_id: e.custom_food_id, external_ref: e.external_ref, food_name: e.food_name,
    quantity: e.quantity, unit: e.unit, grams: e.grams, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat,
  };
}

/** Clone snapshot items into new rows for `date` / `meal` with fresh ids. */
export function cloneItems(
  items: EntrySnapshot[],
  opts: { userId: string; date: string; meal: MealType; newId: () => string; now: string },
): MealEntryRow[] {
  return items.map((it) => ({
    ...snapshotOf(it), id: opts.newId(), user_id: opts.userId, date: opts.date, meal_type: opts.meal, created_at: opts.now,
  }));
}

/** Copy entries (optionally one slot) from another day to `toDate` with new ids, keeping each entry's slot. */
export function copyEntries(
  source: MealEntryRow[],
  opts: { userId: string; toDate: string; meal?: MealType; newId: () => string; now: string },
): MealEntryRow[] {
  return source
    .filter((e) => !opts.meal || e.meal_type === opts.meal)
    .map((e) => ({ ...e, id: opts.newId(), user_id: opts.userId, date: opts.toDate, created_at: opts.now }));
}

export function favouriteFromEntries(
  entries: MealEntryRow[],
  opts: { id: string; userId: string; name: string; meal: MealType; now: string },
): FavouriteMealRow {
  return {
    id: opts.id, user_id: opts.userId, name: opts.name.trim(), meal_type: opts.meal,
    items: entries.filter((e) => e.meal_type === opts.meal).map(snapshotOf), created_at: opts.now,
  };
}

// ---------------------------------------------------------------- custom food

export interface CustomFoodInput {
  name: string; kcal: string; protein: string; carbs: string; fat: string; fibre: string;
  servingLabel: string; servingG: string;
}

export function validateCustomFood(i: CustomFoodInput): { error: string | null; values?: Omit<CustomFoodRow, "id" | "user_id" | "created_at"> } {
  if (!i.name.trim()) return { error: "Name is required." };
  const parse = (s: string) => (s.trim() === "" ? 0 : Number(s));
  const kcal = Number(i.kcal);
  if (i.kcal.trim() === "" || !Number.isFinite(kcal)) return { error: "Calories per 100 g are required." };
  const protein = parse(i.protein), carbs = parse(i.carbs), fat = parse(i.fat), fibre = parse(i.fibre);
  if ([kcal, protein, carbs, fat, fibre].some((x) => !Number.isFinite(x) || x < 0)) return { error: "Nutrition values must be numbers of 0 or more." };
  if (kcal > MAX_KCAL_PER_100G) return { error: "Calories per 100 g cannot be more than 900." };
  if (protein > 100 || carbs > 100 || fat > 100 || fibre > 100) return { error: "Macros per 100 g cannot be more than 100 g." };
  const servingG = i.servingG.trim() === "" ? 100 : Number(i.servingG);
  if (!Number.isFinite(servingG) || servingG <= 0 || servingG > MAX_GRAMS) return { error: "Serving size must be greater than 0 g." };
  return {
    error: null,
    values: {
      name: i.name.trim(), kcal_per_100g: kcal, protein_per_100g: protein, carbs_per_100g: carbs, fat_per_100g: fat,
      fibre_per_100g: fibre, serving_label: i.servingLabel.trim() || "1 serving", serving_g: servingG, unit_grams: {},
    },
  };
}

// ---------------------------------------------------------------- offline merge

/**
 * While writes are still queued, the server copy of a day is stale. Keep local rows (new/edited) and
 * hide locally deleted ids; otherwise the server copy wins.
 */
export function mergeDay(server: MealEntryRow[], local: MealEntryRow[], deleted: string[], hasPending: boolean): MealEntryRow[] {
  if (!hasPending) return server;
  const del = new Set(deleted);
  const localById = new Map(local.map((e) => [e.id, e]));
  const out = server.filter((e) => !del.has(e.id)).map((e) => localById.get(e.id) ?? e);
  const serverIds = new Set(server.map((e) => e.id));
  for (const e of local) if (!serverIds.has(e.id) && !del.has(e.id)) out.push(e);
  return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
