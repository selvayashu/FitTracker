/** Wires real implementations for one request. */
import type { EmailDeps } from "./handlers";
import { createEmailStore } from "./store";

export function buildEmailDeps(env: Env): EmailDeps {
  return {
    store: createEmailStore({ url: env.SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY }),
    fetch: (input, init) => fetch(input, init),
    config: {
      cronSecret: env.CRON_SECRET ?? "",
      tokenSecret: env.EMAIL_TOKEN_SECRET ?? "",
      resendKey: env.RESEND_API_KEY ?? "",
      emailFrom: env.EMAIL_FROM || undefined,
    },
    nowMs: () => Date.now(),
    log: (m) => console.log(`[email] ${m}`),
  };
}
