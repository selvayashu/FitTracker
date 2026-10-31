import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/** Only the anon key ever reaches the browser. The service-role key lives in Worker secrets. */
export const supabase = createClient(
  url ?? "http://localhost:54321",
  anonKey ?? "missing-anon-key",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
