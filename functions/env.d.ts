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
  /** Optional. The id returned when the webhook subscription was created; when set, webhook events from any other subscription are ignored. */
  STRAVA_SUBSCRIPTION_ID?: string;
  /** Phase 4 (weekly email). */
  RESEND_API_KEY: string;
  /** e.g. "FitTrack <summary@yourdomain.com>". Defaults to Resend's sandbox sender, which only delivers to your own Resend account email. */
  EMAIL_FROM?: string;
  /** Shared secret that the Supabase cron job sends in the `x-cron-secret` header. */
  CRON_SECRET: string;
  /** HMAC key for one-click unsubscribe links. */
  EMAIL_TOKEN_SECRET: string;
}
