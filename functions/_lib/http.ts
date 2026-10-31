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
