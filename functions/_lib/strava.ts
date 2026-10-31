/** Strava HTTP client. `fetch` is injected so it can be faked; tokens never appear in errors or logs. */
import { retryAfterSeconds } from "@fittrack/shared";
import type { StravaDetailedActivity, StravaHrStream, StravaTokenResponse } from "@fittrack/shared";

const AUTHORIZE_URL = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTH_URL = "https://www.strava.com/oauth/deauthorize";
const API = "https://www.strava.com/api/v3";

export const REQUIRED_SCOPE = "activity:read_all";

export class StravaHttpError extends Error {
  constructor(
    public status: number,
    /** Only set for 429. */
    public retryAfterSec: number | null = null,
    /** Token endpoint said the grant (refresh token) is invalid or revoked. */
    public grantInvalid = false,
  ) {
    super(`Strava request failed (${status})`);
    this.name = "StravaHttpError";
  }
}

export interface RateLimitState {
  exhausted: boolean;
  retryAfterSec: number;
  usage: string | null;
  limit: string | null;
}

export interface StravaClient {
  exchangeCode(code: string): Promise<StravaTokenResponse>;
  refreshToken(refreshToken: string): Promise<StravaTokenResponse>;
  listActivities(
    accessToken: string,
    opts: { after: number; page: number; perPage: number },
  ): Promise<Array<{ id: number }>>;
  getActivity(accessToken: string, id: number): Promise<StravaDetailedActivity>;
  /** Cheap authenticated call (GET /athlete); throws StravaHttpError (401 when access was revoked). */
  getAthlete(accessToken: string): Promise<void>;
  /** null when the activity has no HR stream. */
  getHrStream(accessToken: string, id: number): Promise<StravaHrStream | null>;
  deauthorize(accessToken: string): Promise<void>;
  /** Latest rate-limit headers seen by this client instance. */
  rateLimit(): RateLimitState;
}

export function buildAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("approval_prompt", "auto");
  u.searchParams.set("scope", `read,${REQUIRED_SCOPE}`);
  u.searchParams.set("state", p.state);
  return u.toString();
}

/** True when a token-endpoint error body says the grant is invalid/revoked (not a client id/secret problem). */
async function isInvalidGrant(res: Response): Promise<boolean> {
  try {
    const b = (await res.json()) as { error?: unknown; errors?: Array<{ field?: unknown; resource?: unknown }> };
    if (b?.error === "invalid_grant") return true;
    return (
      Array.isArray(b?.errors) &&
      b.errors.some((e) => e?.field === "refresh_token" || e?.resource === "RefreshToken")
    );
  } catch {
    return false;
  }
}

function pair(v: string | null): [number, number] | null {
  if (!v) return null;
  const a = v.split(",").map((x) => Number(x.trim()));
  return a.length >= 2 && Number.isFinite(a[0]) && Number.isFinite(a[1]) ? [a[0], a[1]] : null;
}

export function createStravaClient(opts: {
  fetch: typeof fetch;
  clientId: string;
  clientSecret: string;
  nowSec?: () => number;
}): StravaClient {
  const doFetch = opts.fetch;
  const nowSec = opts.nowSec ?? (() => Math.floor(Date.now() / 1000));
  let usage: string | null = null;
  let limit: string | null = null;

  async function request(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await doFetch(url, init);
    } catch {
      throw new StravaHttpError(0);
    }
    const h = res.headers;
    const u = h.get("X-ReadRateLimit-Usage") ?? h.get("X-RateLimit-Usage");
    const l = h.get("X-ReadRateLimit-Limit") ?? h.get("X-RateLimit-Limit");
    if (u) usage = u;
    if (l) limit = l;
    if (res.status === 429) {
      throw new StravaHttpError(
        429,
        retryAfterSeconds({ retryAfter: h.get("Retry-After"), usage: u ?? usage, limit: l ?? limit }, nowSec()),
      );
    }
    if (!res.ok) {
      let grantInvalid = false;
      if (url === TOKEN_URL && (res.status === 400 || res.status === 401)) {
        grantInvalid = await isInvalidGrant(res);
      }
      throw new StravaHttpError(res.status, null, grantInvalid);
    }
    return res;
  }

  const bearer = (t: string): RequestInit => ({ method: "GET", headers: { Authorization: `Bearer ${t}` } });

  async function tokenCall(params: Record<string, string>): Promise<StravaTokenResponse> {
    const body = new URLSearchParams({ client_id: opts.clientId, client_secret: opts.clientSecret, ...params });
    const res = await request(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const j = (await res.json()) as StravaTokenResponse;
    if (!j || typeof j.access_token !== "string" || typeof j.refresh_token !== "string" || typeof j.expires_at !== "number") {
      throw new StravaHttpError(502);
    }
    return j;
  }

  return {
    exchangeCode: (code) => tokenCall({ code, grant_type: "authorization_code" }),
    refreshToken: (refreshToken) => tokenCall({ refresh_token: refreshToken, grant_type: "refresh_token" }),
    async listActivities(token, o) {
      const q = new URLSearchParams({ after: String(o.after), per_page: String(o.perPage), page: String(o.page) });
      const res = await request(`${API}/athlete/activities?${q.toString()}`, bearer(token));
      const j = (await res.json()) as unknown;
      if (!Array.isArray(j)) throw new StravaHttpError(502);
      return j.filter((x): x is { id: number } => !!x && typeof (x as { id?: unknown }).id === "number");
    },
    async getAthlete(token) {
      await request(`${API}/athlete`, bearer(token));
    },
    async getActivity(token, id) {
      const res = await request(`${API}/activities/${id}?include_all_efforts=false`, bearer(token));
      return (await res.json()) as StravaDetailedActivity;
    },
    async getHrStream(token, id) {
      let res: Response;
      try {
        res = await request(`${API}/activities/${id}/streams?keys=time,heartrate&key_by_type=true`, bearer(token));
      } catch (e) {
        if (e instanceof StravaHttpError && e.status === 404) return null;
        throw e;
      }
      const j = (await res.json()) as { time?: { data?: number[] }; heartrate?: { data?: number[] } };
      const time = j?.time?.data;
      const heartrate = j?.heartrate?.data;
      if (!Array.isArray(time) || !Array.isArray(heartrate)) return null;
      return { time, heartrate };
    },
    async deauthorize(token) {
      await request(DEAUTH_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: token }).toString(),
      });
    },
    rateLimit() {
      const u = pair(usage);
      const l = pair(limit);
      const exhausted = !!(u && l && (u[0] >= l[0] || u[1] >= l[1]));
      return {
        exhausted,
        retryAfterSec: exhausted ? retryAfterSeconds({ usage, limit }, nowSec()) : 0,
        usage,
        limit,
      };
    },
  };
}
