/** Wires real implementations (Supabase service role, Strava over fetch) for one request. */
import { createTokenVerifier } from "./auth";
import { requireConfig } from "./http";
import type { HandlerDeps } from "./handlers";
import { createStravaClient } from "./strava";
import { createSupabaseStore } from "./store";

export function buildDeps(env: Env): HandlerDeps {
  requireConfig(env, [
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_STATE_SECRET", "STRAVA_WEBHOOK_VERIFY_TOKEN",
  ]);
  let count = 0;
  // Every outbound subrequest (Strava and Supabase) goes through this counter.
  const countingFetch: typeof fetch = (input, init) => {
    count++;
    return fetch(input, init);
  };
  return {
    store: createSupabaseStore({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      fetch: countingFetch,
    }),
    strava: createStravaClient({
      fetch: countingFetch,
      clientId: env.STRAVA_CLIENT_ID,
      clientSecret: env.STRAVA_CLIENT_SECRET,
    }),
    verifyToken: createTokenVerifier({
      supabaseUrl: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      fetch: countingFetch,
    }),
    config: {
      clientId: env.STRAVA_CLIENT_ID,
      stateSecret: env.STRAVA_STATE_SECRET,
      webhookVerifyToken: env.STRAVA_WEBHOOK_VERIFY_TOKEN,
      subscriptionId: env.STRAVA_SUBSCRIPTION_ID || undefined,
    },
    nowMs: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    used: () => count,
    log: (m) => console.log(`[strava] ${m}`),
  };
}
