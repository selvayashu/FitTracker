/** Verifies the caller's Supabase access token. A user id is never taken from the request body. */
import { createClient } from "@supabase/supabase-js";

export function createTokenVerifier(opts: {
  supabaseUrl: string;
  anonKey: string;
  fetch?: typeof fetch;
}): (token: string) => Promise<string | null> {
  return async (token) => {
    if (!token) return null;
    try {
      const client = createClient(opts.supabaseUrl, opts.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: opts.fetch ? { fetch: opts.fetch } : undefined,
      });
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user?.id) return null;
      return data.user.id;
    } catch {
      return null;
    }
  };
}
