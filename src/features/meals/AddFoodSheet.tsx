import { useEffect, useState } from "react";
import type { MealType } from "@fittrack/shared";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/States";
import { enqueue } from "@/lib/outbox";
import type { CustomFoodRow } from "@/lib/database.types";
import { OffUnavailableError, searchFoods, searchOpenFoodFacts } from "./api";
import { loadCustom, loadRecent, pushRecent, saveCustom } from "./cache";
import {
  MEAL_SLOTS, UNITS, fromCustomRow, rankFoods, resolveGrams, validateCustomFood, validateQuantity,
  type EntryUnit, type FoodItem,
} from "./logic";
import { scaleNutrition } from "@fittrack/shared";

const inputCls = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900";
const btnPrimary = "rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const btnGhost = "rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600";

interface Props {
  userId: string;
  meal: MealType;
  onAdd: (food: FoodItem, quantity: number, unit: EntryUnit) => void;
  onClose: () => void;
}

type Step = { name: "search" } | { name: "custom" } | { name: "qty"; food: FoodItem };

export function AddFoodSheet({ userId, meal, onAdd, onClose }: Props) {
  const [step, setStep] = useState<Step>({ name: "search" });
  const label = MEAL_SLOTS.find((s) => s.type === meal)?.label ?? "";
  const title = step.name === "custom" ? "New custom food" : step.name === "qty" ? step.food.name : `Add to ${label}`;

  const pick = (food: FoodItem) => { setStep({ name: "qty", food }); };

  return (
    <Sheet title={title} onClose={onClose}>
      {step.name === "search" && <SearchStep userId={userId} onPick={pick} onCustom={() => setStep({ name: "custom" })} />}
      {step.name === "custom" && (
        <CustomFoodForm userId={userId} onCancel={() => setStep({ name: "search" })} onSaved={(row) => pick(fromCustomRow(row))} />
      )}
      {step.name === "qty" && (
        <QuantityStep
          food={step.food}
          onBack={() => setStep({ name: "search" })}
          onConfirm={(q, u) => { pushRecent(step.food); onAdd(step.food, q, u); }}
        />
      )}
    </Sheet>
  );
}

function SearchStep({ userId, onPick, onCustom }: { userId: string; onPick: (f: FoodItem) => void; onCustom: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FoodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [searched, setSearched] = useState("");
  const [off, setOff] = useState<{ loading: boolean; items: FoodItem[]; error: string | null; done: boolean }>({ loading: false, items: [], error: null, done: false });
  const [retry, setRetry] = useState(0);
  const recent = loadRecent();

  useEffect(() => {
    const q = query.trim();
    setOff({ loading: false, items: [], error: null, done: false });
    if (q.length < 2) { setResults([]); setError(null); setOffline(false); setSearched(""); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        if (!navigator.onLine) throw new Error("offline");
        const items = await searchFoods(userId, q);
        if (cancelled) return;
        setResults(items);
        setOffline(false);
      } catch {
        if (cancelled) return;
        // Offline or failing: search what is cached on this device.
        const local = [...loadCustom(userId).map(fromCustomRow), ...loadRecent()];
        const seen = new Set<string>();
        const items = rankFoods(local, q).filter((f) => f.name.toLowerCase().includes(q.toLowerCase()) && !seen.has(f.name) && !!seen.add(f.name));
        setResults(items);
        setOffline(true);
        if (navigator.onLine) setError("Search failed, showing saved foods only.");
      } finally {
        if (!cancelled) { setLoading(false); setSearched(q); }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, userId, retry]);

  async function searchPackaged() {
    setOff({ loading: true, items: [], error: null, done: false });
    try {
      const items = await searchOpenFoodFacts(query.trim());
      setOff({ loading: false, items, error: null, done: true });
    } catch (e) {
      const msg = e instanceof OffUnavailableError && navigator.onLine
        ? "Packaged food search is not available right now. You can add a custom food instead."
        : "You are offline, so packaged foods cannot be searched. You can add a custom food instead.";
      setOff({ loading: false, items: [], error: msg, done: true });
    }
  }

  const showRecent = query.trim().length < 2 && recent.length > 0;
  const canOff = searched !== "" && !loading && results.length < 3 && !off.done && !off.loading && navigator.onLine;

  return (
    <div className="space-y-3">
      <input
        autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder="Search foods, e.g. roti, dal, banana" aria-label="Search foods" className={inputCls}
      />
      {offline && <p className="text-xs text-amber-700 dark:text-amber-300">Offline: showing foods saved on this device.</p>}
      {error && (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error} <button className="underline" onClick={() => setRetry((n) => n + 1)}>Retry</button>
        </p>
      )}
      {loading && <Spinner label="Searching" />}
      {showRecent && <FoodList title="Recent" items={recent} onPick={onPick} />}
      {!loading && results.length > 0 && <FoodList title="Results" items={results} onPick={onPick} />}
      {!loading && searched !== "" && results.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">No foods found for "{searched}".</p>
      )}
      {canOff && (
        <button className={btnGhost + " w-full"} onClick={() => void searchPackaged()}>Search packaged foods</button>
      )}
      {off.loading && <Spinner label="Searching packaged foods" />}
      {off.error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{off.error}</p>}
      {off.done && !off.error && off.items.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">No packaged foods with calorie data found.</p>
      )}
      {off.items.length > 0 && <FoodList title="Packaged foods (Open Food Facts)" items={off.items} onPick={onPick} />}
      <button className="w-full rounded-lg border border-dashed border-slate-400 px-3 py-2 text-sm dark:border-slate-600" onClick={onCustom}>
        + Create custom food
      </button>
    </div>
  );
}

function FoodList({ title, items, onPick }: { title: string; items: FoodItem[]; onPick: (f: FoodItem) => void }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
        {items.map((f, i) => (
          <li key={`${f.source}-${f.food_id ?? f.custom_food_id ?? f.external_ref}-${i}`}>
            <button onClick={() => onPick(f)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm">
              <span className="min-w-0">
                <span className="block truncate">{f.name}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                  {f.source === "custom" ? "Custom" : f.brand ?? (f.source === "off" ? "Packaged" : f.serving_label)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{f.per100.kcal} kcal/100 g</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function QuantityStep({ food, onBack, onConfirm }: { food: FoodItem; onBack: () => void; onConfirm: (q: number, u: EntryUnit) => void }) {
  const [qtyText, setQtyText] = useState(food.source === "off" ? "100" : "1");
  const [unit, setUnit] = useState<EntryUnit>(food.source === "off" ? "g" : "serving");
  const qty = Number(qtyText);
  const error = validateQuantity(food, qty, unit);
  const grams = error ? 0 : resolveGrams(food, qty, unit);
  const n = error ? null : scaleNutrition(food.per100, grams);
  const step = (d: number) => {
    const next = Math.max(0.5, Math.round(((Number.isFinite(qty) ? qty : 0) + d) * 2) / 2);
    setQtyText(String(next));
  };

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!error) onConfirm(qty, unit); }}>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="meal-qty" className="mb-1 block text-xs font-medium">Quantity</label>
          <div className="flex gap-1">
            <button type="button" aria-label="Decrease quantity" className={btnGhost} onClick={() => step(-0.5)}>-</button>
            <input
              id="meal-qty" type="number" inputMode="decimal" step="any" min="0" value={qtyText}
              onChange={(e) => setQtyText(e.target.value)} className={inputCls + " text-center"}
            />
            <button type="button" aria-label="Increase quantity" className={btnGhost} onClick={() => step(0.5)}>+</button>
          </div>
        </div>
        <div className="flex-1">
          <label htmlFor="meal-unit" className="mb-1 block text-xs font-medium">Unit</label>
          <select id="meal-unit" value={unit} onChange={(e) => setUnit(e.target.value as EntryUnit)} className={inputCls}>
            <option value="serving">serving ({food.serving_label})</option>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {n && (
        <div className="rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-900" aria-live="polite">
          <p className="font-semibold">{n.kcal} kcal <span className="font-normal text-slate-500 dark:text-slate-400">({grams} g)</span></p>
          <p className="text-slate-600 dark:text-slate-300">Protein {n.protein} g, carbs {n.carbs} g, fat {n.fat} g</p>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className={btnGhost} onClick={onBack}>Back</button>
        <button type="submit" disabled={!!error} className={btnPrimary + " flex-1"}>Add</button>
      </div>
    </form>
  );
}

function CustomFoodForm({ userId, onCancel, onSaved }: { userId: string; onCancel: () => void; onSaved: (r: CustomFoodRow) => void }) {
  const [f, setF] = useState({ name: "", kcal: "", protein: "", carbs: "", fat: "", fibre: "", servingLabel: "1 serving", servingG: "100" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error: err, values } = validateCustomFood(f);
    if (err || !values) { setError(err); return; }
    const row: CustomFoodRow = { ...values, id: crypto.randomUUID(), user_id: userId, created_at: new Date().toISOString() };
    saveCustom(userId, [...loadCustom(userId), row]);
    try {
      await enqueue({ kind: "upsert", table: "custom_foods", row: row as unknown as Record<string, unknown> & { id: string } });
    } catch {
      setError("Could not save the food on this device.");
      return;
    }
    onSaved(row);
  }

  const num = (id: string, label: string, k: keyof typeof f, step = "any") => (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">{label}</label>
      <input id={id} type="number" inputMode="decimal" min="0" step={step} value={f[k]} onChange={set(k)} className={inputCls} />
    </div>
  );

  return (
    <form onSubmit={(e) => void save(e)} className="space-y-3">
      <div>
        <label htmlFor="cf-name" className="mb-1 block text-xs font-medium">Name</label>
        <input id="cf-name" required value={f.name} onChange={set("name")} className={inputCls} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">Nutrition per 100 g</p>
      <div className="grid grid-cols-2 gap-2">
        {num("cf-kcal", "Calories (kcal)", "kcal")}
        {num("cf-protein", "Protein (g)", "protein")}
        {num("cf-carbs", "Carbs (g)", "carbs")}
        {num("cf-fat", "Fat (g)", "fat")}
        {num("cf-fibre", "Fibre (g)", "fibre")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="cf-slabel" className="mb-1 block text-xs font-medium">Serving label</label>
          <input id="cf-slabel" value={f.servingLabel} onChange={set("servingLabel")} className={inputCls} />
        </div>
        {num("cf-sg", "Serving size (g)", "servingG")}
      </div>
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={btnGhost} onClick={onCancel}>Back</button>
        <button type="submit" className={btnPrimary + " flex-1"}>Save and use</button>
      </div>
    </form>
  );
}
