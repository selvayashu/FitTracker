import type { CustomFoodRow, FavouriteMealRow, MealEntryRow } from "@/lib/database.types";
import type { FoodItem } from "./logic";

const P = "fittrack.meals.v1.";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(P + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(P + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export interface DayCache { entries: MealEntryRow[]; deleted: string[] }

export const loadDay = (userId: string, date: string): DayCache => read(`day.${userId}.${date}`, { entries: [], deleted: [] });
export const saveDay = (userId: string, date: string, c: DayCache) => write(`day.${userId}.${date}`, c);

export const loadRecent = (): FoodItem[] => read("recent", []);
export function pushRecent(food: FoodItem) {
  const key = (f: FoodItem) => `${f.source}:${f.food_id ?? f.custom_food_id ?? f.external_ref}`;
  write("recent", [food, ...loadRecent().filter((f) => key(f) !== key(food))].slice(0, 20));
}

export const loadCustom = (userId: string): CustomFoodRow[] => read(`custom.${userId}`, []);
export const saveCustom = (userId: string, rows: CustomFoodRow[]) => write(`custom.${userId}`, rows);
export const loadFavs = (userId: string): FavouriteMealRow[] => read(`favs.${userId}`, []);
export const saveFavs = (userId: string, rows: FavouriteMealRow[]) => write(`favs.${userId}`, rows);
