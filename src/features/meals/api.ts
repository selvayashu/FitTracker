import { supabase } from "@/lib/supabase";
import type { CustomFoodRow, FavouriteMealRow, FoodRow, MealEntryRow } from "@/lib/database.types";
import { escapeLike, fromCustomRow, fromFoodRow, mapOffResponse, rankFoods, type FoodItem } from "./logic";

export async function fetchDay(userId: string, date: string): Promise<MealEntryRow[]> {
  const { data, error } = await supabase.from("meal_entries").select("*").eq("user_id", userId).eq("date", date).order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as MealEntryRow[];
}

export async function fetchCustomFoods(userId: string): Promise<CustomFoodRow[]> {
  const { data, error } = await supabase.from("custom_foods").select("*").eq("user_id", userId).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomFoodRow[];
}

export async function fetchFavourites(userId: string): Promise<FavouriteMealRow[]> {
  const { data, error } = await supabase.from("favourite_meals").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as FavouriteMealRow[];
}

/** Search seeded foods and the user's custom foods, best match first. */
export async function searchFoods(userId: string, query: string): Promise<FoodItem[]> {
  const pattern = `%${escapeLike(query)}%`;
  const [foods, custom] = await Promise.all([
    supabase.from("foods").select("*").ilike("name", pattern).limit(40),
    supabase.from("custom_foods").select("*").eq("user_id", userId).ilike("name", pattern).limit(20),
  ]);
  if (foods.error) throw new Error(foods.error.message);
  if (custom.error) throw new Error(custom.error.message);
  const items = [
    ...((custom.data ?? []) as CustomFoodRow[]).map(fromCustomRow),
    ...((foods.data ?? []) as FoodRow[]).map(fromFoodRow),
  ];
  return rankFoods(items, query).slice(0, 20);
}

export class OffUnavailableError extends Error {}

export async function searchOpenFoodFacts(query: string, signal?: AbortSignal): Promise<FoodItem[]> {
  const url = "https://world.openfoodfacts.org/cgi/search.pl?search_terms=" + encodeURIComponent(query) +
    "&search_simple=1&action=process&json=1&page_size=10&fields=code,product_name,brands,nutriments";
  let res: Response;
  try { res = await fetch(url, { signal }); } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new OffUnavailableError("Open Food Facts could not be reached.");
  }
  if (!res.ok) throw new OffUnavailableError("Open Food Facts is not responding right now.");
  try { return mapOffResponse(await res.json()); } catch { throw new OffUnavailableError("Open Food Facts sent an unreadable response."); }
}
