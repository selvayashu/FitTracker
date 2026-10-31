import { useCallback, useEffect, useRef, useState } from "react";
import type { MealType } from "@fittrack/shared";
import { Sheet } from "@/components/Sheet";
import { EmptyState, ErrorState, Spinner } from "@/components/States";
import { addDaysIst, formatIstDate, istToday } from "@/lib/time";
import { enqueue, getOutboxState, subscribeOutbox } from "@/lib/outbox";
import { useSession } from "@/lib/session";
import type { FavouriteMealRow, MealEntryRow } from "@/lib/database.types";
import { AddFoodSheet } from "./AddFoodSheet";
import { fetchDay, fetchFavourites } from "./api";
import { loadDay, loadFavs, saveDay, saveFavs } from "./cache";
import {
  MEAL_SLOTS, buildEntry, cloneItems, copyEntries, favouriteFromEntries, mergeDay, rescaleEntry, slotTotals,
  sumEntries, validateEntryQuantity, type EntryUnit, type FoodItem,
} from "./logic";

const btnGhost = "rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-slate-600";
const btnPrimary = "rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const asRow = (r: unknown) => r as Record<string, unknown> & { id: string };

type Dialog =
  | { kind: "add"; meal: MealType }
  | { kind: "edit"; entry: MealEntryRow }
  | { kind: "saveFav"; meal: MealType }
  | { kind: "pickFav"; meal: MealType };

export function MealsPage() {
  const { user } = useSession();
  const userId = user?.id ?? "";
  const today = istToday();
  const [date, setDate] = useState(today);
  const [entries, setEntries] = useState<MealEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const deletedRef = useRef<string[]>([]);

  useEffect(() => subscribeOutbox((s) => setOnline(s.online)), []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const cached = loadDay(userId, date);
    deletedRef.current = cached.deleted;
    setLoading(true);
    setError(null);
    setNotice(null);
    (async () => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const server = await fetchDay(userId, date);
        if (cancelled) return;
        const pending = getOutboxState().pending > 0;
        const merged = mergeDay(server, cached.entries, cached.deleted, pending);
        const del = pending ? cached.deleted : [];
        deletedRef.current = del;
        setEntries(merged);
        setStale(false);
        saveDay(userId, date, { entries: merged, deleted: del });
      } catch {
        if (cancelled) return;
        if (!navigator.onLine || cached.entries.length > 0) {
          setEntries(cached.entries);
          setStale(true);
        } else {
          setError("Could not load your meals. Check your connection and try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, date, reloadKey]);

  const commit = useCallback((next: MealEntryRow[], deletedIds?: string[]) => {
    setEntries(next);
    const del = deletedIds ?? deletedRef.current;
    deletedRef.current = del;
    saveDay(userId, date, { entries: next, deleted: del });
  }, [userId, date]);

  async function addRows(rows: MealEntryRow[]) {
    commit([...entries, ...rows]);
    for (const r of rows) await enqueue({ kind: "upsert", table: "meal_entries", row: asRow(r) });
  }

  async function addFood(meal: MealType, food: FoodItem, quantity: number, unit: EntryUnit) {
    const row = buildEntry({
      id: crypto.randomUUID(), userId, date, meal, food, quantity, unit, createdAt: new Date().toISOString(),
    });
    setDialog(null);
    await addRows([row]);
  }

  async function removeEntry(e: MealEntryRow) {
    commit(entries.filter((x) => x.id !== e.id), [...deletedRef.current, e.id]);
    await enqueue({ kind: "delete", table: "meal_entries", id: e.id });
  }

  async function updateQuantity(e: MealEntryRow, quantity: number) {
    const next = rescaleEntry(e, quantity);
    commit(entries.map((x) => (x.id === e.id ? next : x)));
    setDialog(null);
    await enqueue({ kind: "upsert", table: "meal_entries", row: asRow(next) });
  }

  async function copyYesterday(meal?: MealType) {
    const from = addDaysIst(date, -1);
    setNotice(null);
    let source: MealEntryRow[];
    try {
      if (!navigator.onLine) throw new Error("offline");
      source = await fetchDay(userId, from);
    } catch {
      source = loadDay(userId, from).entries;
      if (source.length === 0 && !navigator.onLine) {
        setNotice("You are offline and yesterday is not saved on this device, so it cannot be copied.");
        return;
      }
    }
    const rows = copyEntries(source, {
      userId, toDate: date, meal, newId: () => crypto.randomUUID(), now: new Date().toISOString(),
    });
    if (rows.length === 0) {
      const label = meal ? MEAL_SLOTS.find((s) => s.type === meal)!.label.toLowerCase() : "meals";
      setNotice(`Yesterday has no ${label} logged, so nothing was copied.`);
      return;
    }
    await addRows(rows);
    setNotice(`Copied ${rows.length} ${rows.length === 1 ? "item" : "items"} from yesterday.`);
  }

  async function saveFavourite(meal: MealType, name: string) {
    const fav = favouriteFromEntries(entries, {
      id: crypto.randomUUID(), userId, name, meal, now: new Date().toISOString(),
    });
    saveFavs(userId, [fav, ...loadFavs(userId)]);
    setDialog(null);
    setNotice(`Saved "${fav.name}" as a favourite.`);
    await enqueue({ kind: "upsert", table: "favourite_meals", row: asRow(fav) });
  }

  async function addFavourite(meal: MealType, fav: FavouriteMealRow) {
    const rows = cloneItems(fav.items, {
      userId, date, meal, newId: () => crypto.randomUUID(), now: new Date().toISOString(),
    });
    setDialog(null);
    if (rows.length === 0) { setNotice("That favourite has no items."); return; }
    await addRows(rows);
    setNotice(`Added ${rows.length} ${rows.length === 1 ? "item" : "items"} from "${fav.name}".`);
  }

  const totals = sumEntries(entries);
  const perSlot = slotTotals(entries);
  const isToday = date >= today;

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <header className="flex items-center justify-between gap-2">
        <button className={btnGhost} aria-label="Previous day" onClick={() => setDate(addDaysIst(date, -1))}>&lt;</button>
        <div className="text-center">
          <h1 className="text-lg font-semibold">{date === today ? "Today" : formatIstDate(date)}</h1>
          {date === today && <p className="text-xs text-slate-500 dark:text-slate-400">{formatIstDate(date)}</p>}
        </div>
        <button className={btnGhost} aria-label="Next day" disabled={isToday} onClick={() => setDate(addDaysIst(date, 1))}>&gt;</button>
      </header>

      {(!online || stale) && (
        <p role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
          {!online ? "You are offline. Showing meals saved on this device; new entries sync later." : "Could not refresh, showing meals saved on this device."}
        </p>
      )}
      {notice && <p role="status" className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900 dark:bg-teal-950 dark:text-teal-100">{notice}</p>}

      {loading && <Spinner label="Loading meals" />}
      {!loading && error && <ErrorState message={error} onRetry={() => setReloadKey((n) => n + 1)} />}

      {!loading && !error && (
        <>
          <section aria-label="Day total" className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-800">
            <p className="text-2xl font-bold">{totals.kcal} <span className="text-sm font-normal text-slate-500 dark:text-slate-400">kcal</span></p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Protein {totals.protein} g · Carbs {totals.carbs} g · Fat {totals.fat} g
            </p>
          </section>

          <div className="flex justify-end">
            <button className={btnGhost} onClick={() => void copyYesterday()}>Copy all from yesterday</button>
          </div>

          {MEAL_SLOTS.map((slot) => {
            const list = entries.filter((e) => e.meal_type === slot.type);
            return (
              <section key={slot.type} aria-label={slot.label} className="rounded-xl bg-white p-4 shadow-sm dark:bg-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="font-semibold">{slot.label}</h2>
                  <span className="text-sm text-slate-600 dark:text-slate-300">{perSlot[slot.type].kcal} kcal</span>
                </div>
                {list.length === 0 ? (
                  <EmptyState title={`Nothing logged for ${slot.label.toLowerCase()}`} hint="Add a food or copy from yesterday." />
                ) : (
                  <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                    {list.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 py-2">
                        <button className="min-w-0 flex-1 text-left" aria-label={`Edit quantity of ${e.food_name}`} onClick={() => setDialog({ kind: "edit", entry: e })}>
                          <span className="block truncate text-sm">{e.food_name}</span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {e.quantity} {e.unit} · {e.grams} g · P {e.protein} C {e.carbs} F {e.fat}
                          </span>
                        </button>
                        <span className="text-sm">{e.kcal}</span>
                        <button className="rounded px-2 py-1 text-xs text-red-700 dark:text-red-300" aria-label={`Remove ${e.food_name}`} onClick={() => void removeEntry(e)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className={btnPrimary} onClick={() => setDialog({ kind: "add", meal: slot.type })}>+ Add food</button>
                  <button className={btnGhost} onClick={() => setDialog({ kind: "pickFav", meal: slot.type })}>Add favourite</button>
                  <button className={btnGhost} onClick={() => void copyYesterday(slot.type)}>Copy yesterday</button>
                  {list.length > 0 && (
                    <button className={btnGhost} onClick={() => setDialog({ kind: "saveFav", meal: slot.type })}>Save as favourite</button>
                  )}
                </div>
              </section>
            );
          })}
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">Values are approximate.</p>
        </>
      )}

      {dialog?.kind === "add" && (
        <AddFoodSheet userId={userId} meal={dialog.meal} onClose={() => setDialog(null)}
          onAdd={(food, q, u) => void addFood(dialog.meal, food, q, u)} />
      )}
      {dialog?.kind === "edit" && (
        <EditSheet entry={dialog.entry} onClose={() => setDialog(null)} onSave={(q) => void updateQuantity(dialog.entry, q)} />
      )}
      {dialog?.kind === "saveFav" && (
        <SaveFavSheet onClose={() => setDialog(null)} onSave={(name) => void saveFavourite(dialog.meal, name)} />
      )}
      {dialog?.kind === "pickFav" && (
        <PickFavSheet userId={userId} onClose={() => setDialog(null)} onPick={(f) => void addFavourite(dialog.meal, f)} />
      )}
    </main>
  );
}

const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900";

function EditSheet({ entry, onSave, onClose }: { entry: MealEntryRow; onSave: (q: number) => void; onClose: () => void }) {
  const [text, setText] = useState(String(entry.quantity));
  const q = Number(text);
  const error = validateEntryQuantity(entry, q);
  const preview = error ? null : rescaleEntry(entry, q);
  return (
    <Sheet title={entry.food_name} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!error) onSave(q); }}>
        <label htmlFor="edit-qty" className="block text-xs font-medium">Quantity ({entry.unit})</label>
        <input id="edit-qty" type="number" inputMode="decimal" step="any" min="0" autoFocus value={text} onChange={(e) => setText(e.target.value)} className={inputCls} />
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {preview && <p className="text-sm" aria-live="polite">{preview.kcal} kcal ({preview.grams} g)</p>}
        <button type="submit" disabled={!!error} className={btnPrimary + " w-full"}>Save</button>
      </form>
    </Sheet>
  );
}

function SaveFavSheet({ onSave, onClose }: { onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <Sheet title="Save as favourite" onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name); }}>
        <label htmlFor="fav-name" className="block text-xs font-medium">Name</label>
        <input id="fav-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. Usual breakfast" />
        <button type="submit" disabled={!name.trim()} className={btnPrimary + " w-full"}>Save</button>
      </form>
    </Sheet>
  );
}

function PickFavSheet({ userId, onPick, onClose }: { userId: string; onPick: (f: FavouriteMealRow) => void; onClose: () => void }) {
  const [favs, setFavs] = useState<FavouriteMealRow[]>(() => loadFavs(userId));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        if (!navigator.onLine) throw new Error("offline");
        const rows = await fetchFavourites(userId);
        if (cancelled) return;
        // Keep locally saved favourites that are still waiting to sync.
        const ids = new Set(rows.map((r) => r.id));
        const merged = [...loadFavs(userId).filter((f) => !ids.has(f.id) && getOutboxState().pending > 0), ...rows];
        setFavs(merged);
        saveFavs(userId, merged);
      } catch {
        if (!cancelled && navigator.onLine && loadFavs(userId).length === 0) setError("Could not load favourites.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, key]);

  return (
    <Sheet title="Add favourite" onClose={onClose}>
      {loading && favs.length === 0 && <Spinner label="Loading favourites" />}
      {error && <ErrorState message={error} onRetry={() => setKey((n) => n + 1)} />}
      {!loading && !error && favs.length === 0 && (
        <EmptyState title="No favourites yet" hint='Use "Save as favourite" on a slot that has food.' />
      )}
      <ul className="space-y-2">
        {favs.map((f) => (
          <li key={f.id}>
            <button className="w-full rounded-lg border border-slate-200 p-3 text-left dark:border-slate-700" onClick={() => onPick(f)}>
              <span className="block text-sm font-medium">{f.name}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {f.items.length} {f.items.length === 1 ? "item" : "items"} · {sumEntries(f.items).kcal} kcal
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
