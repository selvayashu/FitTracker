import { describe, expect, it } from "vitest";
import { StravaHttpError, createStravaClient } from "./strava";

const mk = (res: () => Response | Promise<Response>) => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createStravaClient({
    clientId: "cid",
    clientSecret: "sec",
    nowSec: () => 1000,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return res();
    }) as unknown as typeof fetch,
  });
  return { client, calls };
};

describe("strava client", () => {
  it("surfaces Retry-After on 429", async () => {
    const { client } = mk(() => new Response("{}", { status: 429, headers: { "Retry-After": "77" } }));
    const err = await client.getActivity("t", 1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StravaHttpError);
    expect((err as StravaHttpError).status).toBe(429);
    expect((err as StravaHttpError).retryAfterSec).toBe(77);
  });

  it("tracks X-RateLimit headers and reports exhaustion", async () => {
    const { client } = mk(
      () =>
        new Response("[]", {
          status: 200,
          headers: { "X-RateLimit-Usage": "100,500", "X-RateLimit-Limit": "100,1000" },
        }),
    );
    expect(client.rateLimit().exhausted).toBe(false);
    await client.listActivities("t", { after: 1, page: 1, perPage: 30 });
    const rl = client.rateLimit();
    expect(rl.exhausted).toBe(true);
    expect(rl.retryAfterSec).toBe(900 - (1000 % 900));
  });

  it("token error messages do not include secrets", async () => {
    const { client } = mk(() => new Response("{}", { status: 400 }));
    const err = (await client.refreshToken("super-refresh").catch((e: unknown) => e)) as Error;
    expect(err.message).not.toMatch(/super-refresh|sec/);
  });

  it("sends the token as a Bearer header, not in the URL", async () => {
    const { client, calls } = mk(() => new Response("[]", { status: 200 }));
    await client.listActivities("tok123", { after: 5, page: 2, perPage: 30 });
    expect(calls[0].url).not.toContain("tok123");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
    expect(calls[0].url).toContain("after=5");
    expect(calls[0].url).toContain("per_page=30");
  });

  it("HR stream: 404 gives null, data is mapped", async () => {
    const a = mk(() => new Response("{}", { status: 404 }));
    expect(await a.client.getHrStream("t", 1)).toBeNull();
    const b = mk(
      () => new Response(JSON.stringify({ time: { data: [0, 1] }, heartrate: { data: [90, 91] } }), { status: 200 }),
    );
    expect(await b.client.getHrStream("t", 1)).toEqual({ time: [0, 1], heartrate: [90, 91] });
  });

  it("network failure becomes status 0", async () => {
    const client = createStravaClient({
      clientId: "c",
      clientSecret: "s",
      fetch: (async () => {
        throw new TypeError("boom");
      }) as unknown as typeof fetch,
    });
    await expect(client.getActivity("t", 1)).rejects.toMatchObject({ status: 0 });
  });
});
