/** HMAC-SHA256 signed OAuth state `{ uid, exp }` (Web Crypto, base64url). */
export const STATE_TTL_SEC = 600;

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time comparison of two strings (length differences are folded into the result). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function signState(secret: string, uid: string, nowSec: number): Promise<string> {
  const payload = b64urlEncode(enc.encode(JSON.stringify({ uid, exp: nowSec + STATE_TTL_SEC })));
  const sig = b64urlEncode(await hmac(secret, payload));
  return `${payload}.${sig}`;
}

/** Returns the user id, or null when the token is malformed, tampered, expired or signed with another secret. */
export async function verifyState(secret: string, token: string, nowSec: number): Promise<string | null> {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64urlEncode(await hmac(secret, payload));
  if (!timingSafeEqualStr(sig, expected)) return null;
  const bytes = b64urlDecode(payload);
  if (!bytes) return null;
  try {
    const obj = JSON.parse(new TextDecoder().decode(bytes)) as { uid?: unknown; exp?: unknown };
    if (typeof obj.uid !== "string" || !obj.uid || typeof obj.exp !== "number") return null;
    if (nowSec >= obj.exp) return null;
    return obj.uid;
  } catch {
    return null;
  }
}
