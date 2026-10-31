/** Worker/Pages Functions bindings. Part of the Phase 2 contract (frozen). Secrets are set in Cloudflare, or in .dev.vars locally. */
interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_WEBHOOK_VERIFY_TOKEN: string;
  /** HMAC key for the OAuth state parameter. */
  STRAVA_STATE_SECRET: string;
}
