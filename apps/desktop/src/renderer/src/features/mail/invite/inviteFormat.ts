import type { Invite, InviteChip, InviteResponse } from "@flint/core/types";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** "2026-10-27" as a local-midnight Date, so all-day events never shift with the viewer's zone. */
function localDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

const fmt = (opts: Intl.DateTimeFormatOptions, tz?: string) => new Intl.DateTimeFormat(undefined, tz ? { ...opts, timeZone: tz } : opts);

function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "3:15 PM", or "3 PM" on the hour. */
function clock(ts: number, tz?: string): string {
  const parts = fmt({ hour: "numeric", minute: "2-digit" }, tz).formatToParts(ts);
  const onHour = parts.find((p) => p.type === "minute")?.value === "00";
  return (onHour ? fmt({ hour: "numeric" }, tz).format(ts) : parts.map((p) => p.value).join("")).replace(/\s+/g, " ").trim();
}

const dayLabel = (ts: number, tz?: string, withYear = false) => fmt({ weekday: "short", month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }, tz).format(ts);

/** Offset in minutes of `tz` (or the local zone) at `ts`. */
function offsetMin(ts: number, tz?: string): number {
  const p = Object.fromEntries(fmt({ hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, tz).formatToParts(ts).map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - Math.floor(ts / 1000) * 1000) / MIN);
}

/** Date and time in the viewer's zone: "Tue, Oct 27 · 3 to 3:45 PM". All-day: "Tue, Oct 27, all day" or "Oct 27 to Oct 29". The year shows when it is not the current one. */
export function whenText(i: Pick<Invite, "start" | "end" | "allDay" | "startDate" | "endDate">, now: number = Date.now()): string {
  const day = (ts: number) => dayLabel(ts, undefined, new Date(ts).getFullYear() !== new Date(now).getFullYear());
  if (i.allDay && i.startDate) {
    const first = localDate(i.startDate);
    const last = new Date((i.endDate ? localDate(i.endDate) : new Date(first.getTime() + DAY)).getTime() - DAY);
    last.setHours(12);
    if (sameLocalDay(first.getTime(), last.getTime())) return `${day(first.getTime())}, all day`;
    return `${day(first.getTime())} to ${day(last.getTime())}`;
  }
  const end = i.end > i.start ? i.end : i.start;
  const startClock = clock(i.start), endClock = clock(end);
  if (end === i.start) return `${day(i.start)} · ${startClock}`;
  if (sameLocalDay(i.start, end)) {
    // "3 - 3:45 PM" reads cleaner when both ends share AM/PM.
    const sa = startClock.split(" ")[1], ea = endClock.split(" ")[1];
    return `${day(i.start)} · ${sa && sa === ea ? startClock.replace(` ${sa}`, "") : startClock} to ${endClock}`;
  }
  return `${day(i.start)} ${startClock} to ${day(end)} ${endClock}`;
}

/** The viewer's own zone abbreviation at `ts` ("PDT"), to tell their line from the organizer's. */
export function localZoneAbbr(ts: number): string {
  return fmt({ timeZoneName: "short" }).formatToParts(ts).find((p) => p.type === "timeZoneName")?.value ?? "";
}

/** The organizer's wall-clock time, only when their zone differs from the viewer's at the start: "6 to 6:45 PM EDT". */
export function organizerZoneText(i: Pick<Invite, "start" | "end" | "allDay" | "timeZone">): string | null {
  if (i.allDay || !i.timeZone || i.timeZone === "UTC" && offsetMin(i.start) === 0) return null;
  try {
    if (offsetMin(i.start, i.timeZone) === offsetMin(i.start)) return null;
    const abbr = fmt({ timeZoneName: "short" }, i.timeZone).formatToParts(i.start).find((p) => p.type === "timeZoneName")?.value ?? i.timeZone;
    const end = i.end > i.start ? i.end : i.start;
    const a = clock(i.start, i.timeZone), b = clock(end, i.timeZone);
    const sa = a.split(" ")[1], ea = b.split(" ")[1];
    const range = end === i.start ? a : `${sa && sa === ea ? a.replace(` ${sa}`, "") : a} to ${b}`;
    return `${range} ${abbr} for the organizer`;
  } catch {
    return null;
  }
}

/** "45 min", "1 hr 30 min", "3 days". Null for zero-length events. */
export function durationText(i: Pick<Invite, "start" | "end" | "allDay" | "startDate" | "endDate">): string | null {
  if (i.allDay) {
    if (!i.startDate || !i.endDate) return null;
    const days = Math.round((localDate(i.endDate).getTime() - localDate(i.startDate).getTime()) / DAY);
    return days > 1 ? `${days} days` : null;
  }
  const mins = Math.round((i.end - i.start) / MIN);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  if (mins % 1440 === 0) return `${mins / 1440} ${mins === 1440 ? "day" : "days"}`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} ${h === 1 ? "hr" : "hrs"}`;
}

/** Thread-row chip time: "Tue 3 PM" within a week, "Oct 27, 3 PM" later, "Tue" for all-day. */
export function chipWhen(c: Pick<InviteChip, "start" | "allDay" | "startDate">, now: number): string {
  const ts = c.allDay && c.startDate ? localDate(c.startDate).getTime() : c.start;
  const near = Math.abs(ts - now) < 6 * DAY;
  const otherYear = new Date(ts).getFullYear() !== new Date(now).getFullYear();
  const day = near ? fmt({ weekday: "short" }).format(ts) : fmt({ month: "short", day: "numeric", ...(otherYear ? { year: "numeric" } : {}) }).format(ts);
  if (c.allDay) return day;
  return `${day}${near ? " " : ", "}${clock(ts)}`;
}

export function chipText(c: InviteChip, now: number): string {
  const lead = c.state === "cancelled" ? "Cancelled" : c.state === "updated" ? "Updated" : c.state === "reply" ? "Reply" : c.state === "past" ? "Past invite" : "Invite";
  return c.state === "reply" ? lead : `${lead} · ${chipWhen(c, now)}`;
}

export const RESPONSE_LABEL: Record<InviteResponse, string> = { accepted: "Going", tentative: "Maybe", declined: "Declined", "needs-action": "Awaiting" };
