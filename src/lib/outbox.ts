import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { supabase } from "./supabase";

/**
 * Offline write queue. Every row carries a client-generated UUID, so replaying an op is idempotent
 * (upsert by primary key, delete by id). Used for meal and activity entry.
 */
export type OutboxTable = "meal_entries" | "activities" | "activity_templates" | "favourite_meals" | "custom_foods";

export type OutboxOp =
  | { kind: "upsert"; table: OutboxTable; row: Record<string, unknown> & { id: string }; onConflict?: string }
  | { kind: "delete"; table: OutboxTable; id: string };

interface Queued { seq?: number; op: OutboxOp; queuedAt: number; error?: string }

interface OutboxDB extends DBSchema {
  ops: { key: number; value: Queued };
}

let dbPromise: Promise<IDBPDatabase<OutboxDB>> | null = null;
const db = () => (dbPromise ??= openDB<OutboxDB>("fittrack-outbox", 1, {
  upgrade(d) { d.createObjectStore("ops", { keyPath: "seq", autoIncrement: true }); },
}));

type Listener = (state: OutboxState) => void;
export interface OutboxState { pending: number; failed: number; flushing: boolean; online: boolean }

const listeners = new Set<Listener>();
let flushing = false;
let state: OutboxState = { pending: 0, failed: 0, flushing: false, online: typeof navigator === "undefined" ? true : navigator.onLine };

async function refresh() {
  const all = await (await db()).getAll("ops");
  state = { pending: all.filter((q) => !q.error).length, failed: all.filter((q) => q.error).length, flushing, online: navigator.onLine };
  listeners.forEach((l) => l(state));
}

export function getOutboxState(): OutboxState { return state; }

export function subscribeOutbox(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => { listeners.delete(l); };
}

/** Queue a write, then try to send immediately when online. Never throws for network problems. */
export async function enqueue(op: OutboxOp): Promise<void> {
  await (await db()).add("ops", { op, queuedAt: Date.now() });
  await refresh();
  if (navigator.onLine) void flush();
}

async function send(op: OutboxOp) {
  if (op.kind === "delete") return supabase.from(op.table).delete().eq("id", op.id);
  return supabase.from(op.table).upsert(op.row, { onConflict: op.onConflict ?? "id" });
}

export async function flush(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  await refresh();
  try {
    const d = await db();
    for (const q of await d.getAll("ops")) {
      if (q.error) continue;
      let res;
      try { res = await send(q.op); } catch { break; }       // network failure: keep and retry later
      if (res.error) {
        // Server-side rejection (validation/RLS): keep it visible instead of retrying forever.
        if (res.error.code && !res.error.message.toLowerCase().includes("fetch")) {
          await d.put("ops", { ...q, error: res.error.message });
          continue;
        }
        break;
      }
      await d.delete("ops", q.seq!);
    }
  } finally {
    flushing = false;
    await refresh();
  }
}

/** Discard ops that the server rejected. */
export async function clearFailed(): Promise<void> {
  const d = await db();
  for (const q of await d.getAll("ops")) if (q.error) await d.delete("ops", q.seq!);
  await refresh();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flush(); });
  window.addEventListener("offline", () => { void refresh(); });
  void refresh().then(() => flush());
}
