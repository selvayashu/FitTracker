/** Weekly email and unsubscribe handlers. Pure of Supabase/Resend specifics: the store and fetch are injected. */
import {
  addDays,
  buildInsights,
  buildWeeklyEmail,
  formatIstDateTime,
  formatRangeLabel,
  istDateOfIso,
  summarizeRange,
} from "@fittrack/shared";
import type { BmiStandard, Goal, Pace, ReportProfile, Sex } from "@fittrack/shared";
import { errorResponse, json, methodNotAllowed, readJsonObject } from "../http";
import { timingSafeEqualStr } from "../state";
import type { EmailProfile, EmailStore } from "./store";
import { UUID_RE, signUnsubscribeToken, verifyUnsubscribeToken } from "./token";

export const DEFAULT_FROM = "FitTrack <onboarding@resend.dev>";
export const RESEND_URL = "https://api.resend.com/emails";
export const RECENT_DAYS = 6;
export const SEND_TIMEOUT_MS = 10_000;

export interface EmailDeps {
  store: EmailStore;
  fetch: typeof fetch;
  config: { cronSecret: string; tokenSecret: string; resendKey: string; emailFrom?: string };
  nowMs: () => number;
  /** Must never receive PII or secrets. */
  log: (m: string) => void;
}

export function toReportProfile(p: EmailProfile | null): ReportProfile | null {
  if (
    !p || !p.sex || !p.dob || !p.height_cm || !p.weight_kg || !p.target_weight_kg || !p.goal || !p.pace ||
    p.daily_kcal_target == null || p.protein_target_g == null || p.carb_target_g == null || p.fat_target_g == null
  ) {
    return null;
  }
  return {
    sex: p.sex as Sex,
    dob: p.dob,
    heightCm: Number(p.height_cm),
    weightKg: Number(p.weight_kg),
    targetWeightKg: Number(p.target_weight_kg),
    goal: p.goal as Goal,
    pace: Number(p.pace) as Pace,
    bmiStandard: (p.bmi_standard ?? "who") as BmiStandard,
    dailyKcalTarget: Number(p.daily_kcal_target),
    proteinTargetG: Number(p.protein_target_g),
    carbTargetG: Number(p.carb_target_g),
    fatTargetG: Number(p.fat_target_g),
    exerciseAddbackPct: Number(p.exercise_addback_pct ?? 50),
  };
}

const notSent = (reason: string, status = 200): Response => json({ sent: false, reason }, status);

export async function handleWeekly(request: Request, deps: EmailDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed(["POST"]);
  const { cronSecret, tokenSecret, resendKey, emailFrom } = deps.config;
  const given = request.headers.get("x-cron-secret") ?? "";
  if (!cronSecret || !given || !timingSafeEqualStr(given, cronSecret)) {
    return errorResponse(401, "unauthorized", "Missing or invalid credentials.");
  }
  const body = await readJsonObject(request);
  const userId = body.user_id;
  const force = body.force;
  if (typeof userId !== "string" || !UUID_RE.test(userId) || (force !== undefined && typeof force !== "boolean")) {
    return errorResponse(400, "invalid_request", "Body must be { user_id: uuid, force?: boolean }.");
  }
  if (!tokenSecret || !resendKey) {
    deps.log("email not configured");
    return errorResponse(500, "not_configured", "Email is not configured.");
  }

  try {
    const profile = await deps.store.getProfile(userId);
    if (!profile) return notSent("no_data");
    if (!profile.email_weekly) return notSent("not_opted_in");
    const now = deps.nowMs();
    if (!force && profile.last_weekly_email_at) {
      const last = Date.parse(profile.last_weekly_email_at);
      if (!Number.isNaN(last) && now - last < RECENT_DAYS * 86_400_000) return notSent("recently_sent");
    }
    const reportProfile = toReportProfile(profile);
    if (!reportProfile) return notSent("no_data");

    const nowIso = new Date(now).toISOString();
    const today = istDateOfIso(nowIso);
    const range = { from: addDays(today, -7), to: addDays(today, -1) };
    const data = await deps.store.fetchWeekData(userId, range);
    const summary = summarizeRange({ range, today, profile: reportProfile, ...data });
    if (summary.loggedDays === 0) return notSent("no_data");

    const email = await deps.store.getUserEmail(userId);
    if (!email) return notSent("no_email");

    const origin = new URL(request.url).origin;
    const unsubscribeUrl = `${origin}/api/email/unsubscribe?token=${await signUnsubscribeToken(tokenSecret, userId)}`;
    const content = buildWeeklyEmail(summary, buildInsights(summary), {
      rangeLabel: formatRangeLabel(range),
      generatedAtIst: formatIstDateTime(new Date(now)),
      userName: profile.name,
      appUrl: origin,
      unsubscribeUrl,
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
    let ok = false;
    try {
      const res = await deps.fetch(RESEND_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: emailFrom || DEFAULT_FROM,
          to: [email],
          subject: content.subject,
          html: content.html,
          text: content.text,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      ok = res.ok;
      if (!ok) deps.log(`resend rejected the message (status ${res.status})`);
    } catch {
      deps.log("resend request failed");
    } finally {
      clearTimeout(timer);
    }
    if (!ok) return notSent("send_failed", 502);

    try {
      await deps.store.setLastWeeklyEmailAt(userId, nowIso);
    } catch {
      deps.log("warning: sent but could not update last_weekly_email_at");
    }
    return json({ sent: true });
  } catch {
    deps.log("weekly email failed");
    return errorResponse(500, "internal_error", "Could not process the request.");
  }
}

// ---------------------------------------------------------------- unsubscribe

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(status: number, title: string, bodyHtml: string): Response {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.5}` +
    `button{font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;border:0;background:#0f766e;color:#fff;cursor:pointer}</style>` +
    `</head><body><h1>${escapeHtml(title)}</h1>${bodyHtml}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

const invalidPage = (): Response =>
  page(400, "Link not valid", "<p>This unsubscribe link is invalid or incomplete. You can switch the weekly email off in FitTrack, under Settings.</p>");

export async function handleUnsubscribe(request: Request, deps: EmailDeps): Promise<Response> {
  const method = request.method;
  if (method !== "GET" && method !== "POST") return methodNotAllowed(["GET", "POST"]);
  const url = new URL(request.url);
  let token = url.searchParams.get("token") ?? "";
  if (method === "POST" && !token) {
    try {
      token = new URLSearchParams(await request.text()).get("token") ?? "";
    } catch {
      token = "";
    }
  }
  const uid = await verifyUnsubscribeToken(deps.config.tokenSecret, token);
  if (!uid) return invalidPage();

  if (method === "GET") {
    return page(
      200,
      "Unsubscribe from the weekly email?",
      `<p>You will stop receiving the FitTrack weekly summary.</p>` +
        `<form method="post" action="/api/email/unsubscribe"><input type="hidden" name="token" value="${escapeHtml(token)}">` +
        `<button type="submit">Unsubscribe</button></form>`,
    );
  }
  try {
    await deps.store.setEmailWeekly(uid, false);
  } catch {
    deps.log("unsubscribe failed");
    return page(500, "Something went wrong", "<p>We could not update your preference. Please try again later.</p>");
  }
  return page(200, "You are unsubscribed", "<p>You will no longer receive the FitTrack weekly summary. You can turn it back on in Settings.</p>");
}
