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

interface Queued { seq?: number; op: OutboxOp; queuedAt: number; userId?: string; error?: string }

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

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Queue a write for the signed-in user, then try to send immediately when online. Never throws for network problems. */
export async function enqueue(op: OutboxOp): Promise<void> {
  await (await db()).add("ops", { op, queuedAt: Date.now(), userId: (await currentUserId()) ?? undefined });
  await refresh();
  if (navigator.onLine) void flush();
}

async function send(op: OutboxOp) {
  if (op.kind === "delete") return supabase.from(op.table).delete().eq("id", op.id);
  return supabase.from(op.table).upsert(op.row, { onConflict: op.onConflict ?? "id" });
}

/** Errors that mean "try again later" (expired token, offline) rather than "the server rejected this row". */
function isRetryable(err: { code?: string; message: string; status?: number }): boolean {
  const msg = err.message.toLowerCase();
  return !err.code || err.code === "PGRST301" || err.status === 401 || err.status === 503 || msg.includes("jwt") || msg.includes("fetch");
}

let dirty = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;

function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 60000);
}

export async function flush(): Promise<void> {
  if (!navigator.onLine) return;
  if (flushing) { dirty = true; return; }   // a running flush will re-check the queue once it finishes
  flushing = true;
  await refresh();
  let needsRetry = false;
  try {
    const d = await db();
    const uid = await currentUserId();
    do {
      dirty = false;
      for (const q of await d.getAll("ops")) {
        if (q.error) continue;
        if (q.userId && q.userId !== uid) continue;   // another account's writes wait for that account
        let res;
        try { res = await send(q.op); } catch { needsRetry = true; break; }
        if (res.error) {
          if (isRetryable(res.error)) { needsRetry = true; break; }
          // Server-side rejection (validation/RLS): keep it visible instead of retrying forever.
          await d.put("ops", { ...q, error: res.error.message });
          continue;
        }
        await d.delete("ops", q.seq!);
        retryDelay = 2000;
      }
    } while (dirty && !needsRetry);
  } finally {
    flushing = false;
    await refresh();
    if (needsRetry) scheduleRetry();
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
