/** Small response helpers. Errors are always `{ error, message }`. */
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

export function errorResponse(status: number, error: string, message: string): Response {
  return json({ error, message }, status);
}

export function methodNotAllowed(allowed: string[]): Response {
  return json({ error: "method_not_allowed", message: "Method not allowed." }, 405, {
    Allow: allowed.join(", "),
  });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });
}

/** Read a JSON object body; anything unparseable becomes an empty object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await request.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function bearerToken(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

/** Thrown when required Worker settings are missing. Carries setting NAMES only, never values. */
export class ConfigError extends Error {
  constructor(public missing: string[]) {
    super("missing configuration");
    this.name = "ConfigError";
  }
}

/** Throw a ConfigError listing every required setting that is unset or empty. */
export function requireConfig(env: Env, names: Array<keyof Env>): void {
  const missing = names.filter((n) => {
    const v = env[n];
    return typeof v !== "string" || v.trim() === "";
  });
  if (missing.length) throw new ConfigError(missing.map(String));
}

/**
 * Error boundary for a route handler. A missing setting becomes a clear JSON 500 that names the setting;
 * anything unexpected becomes a generic JSON 500. Never exposes error messages, stacks or values.
 */
export function guarded(fn: PagesFunction<Env>): PagesFunction<Env> {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof ConfigError) {
        return errorResponse(500, "not_configured", `Server configuration is incomplete. Missing: ${e.missing.join(", ")}.`);
      }
      console.error(`unhandled error: ${e instanceof Error ? e.name : "unknown"}`);
      return errorResponse(500, "internal_error", "Something went wrong on the server.");
    }
  };
}
