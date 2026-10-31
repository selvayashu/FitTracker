/** All timestamps are stored in UTC; the user's calendar day is the Asia/Kolkata day. IST has no DST (UTC+05:30). */
export const IST = "Asia/Kolkata";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });

/** YYYY-MM-DD of the IST calendar day containing `d`. */
export function istDateOf(input: string | Date): string {
  return dateFmt.format(typeof input === "string" ? new Date(input) : input);
}

export function istToday(): string {
  return istDateOf(new Date());
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDaysIst(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return istDateOf(d);
}

/** Convert an IST date + HH:mm to a UTC ISO string. */
export function toUtcIso(istDate: string, hhmm: string): string {
  return new Date(`${istDate}T${hhmm}:00+05:30`).toISOString();
}

/** HH:mm in IST. */
export function istTimeOf(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** e.g. "Thu, 5 Mar, 06:30 am" in IST. */
export function formatIst(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export function formatIstDate(date: string): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short" })
    .format(new Date(`${date}T00:00:00+05:30`));
}

/** "hh:mm" text (e.g. "01:30") to minutes; returns 0 when invalid. */
export function parseDuration(text: string): number {
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function formatDuration(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
