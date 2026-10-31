/** Unsubscribe token: `<uuid>.<base64url HMAC-SHA256(secret, "unsubscribe:" + uuid)>`. No expiry. */
import { timingSafeEqualStr } from "../state";

const enc = new TextEncoder();
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mac(secret: string, uid: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`unsubscribe:${uid}`))));
}

export async function signUnsubscribeToken(secret: string, uid: string): Promise<string> {
  return `${uid}.${await mac(secret, uid)}`;
}

/** Returns the user id, or null for a malformed/tampered token or an empty secret. */
export async function verifyUnsubscribeToken(secret: string, token: string): Promise<string | null> {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [uid, sig] = parts;
  if (!UUID_RE.test(uid)) return null;
  return timingSafeEqualStr(sig, await mac(secret, uid)) ? uid : null;
}
