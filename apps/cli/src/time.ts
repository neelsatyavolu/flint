import { FlintError } from "@flint/core/types";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: DAY_MS, w: 7 * DAY_MS };
const DEFAULT_HOUR = 8;

const bad = (input: string): FlintError =>
  new FlintError("invalid", `Couldn't read "${input}" as a time. Try 2h, 30m, tomorrow, monday or "2026-10-26 09:00".`);

function weekdayIndex(word: string): number {
  if (word.length < 3) return -1;
  return WEEKDAYS.findIndex((d) => d.startsWith(word));
}

/**
 * Parses "2h", "30m", "3d", "tomorrow" (8am next day), "today 5pm", "monday",
 * "2026-10-26", "2026-10-26 09:00", or an ISO timestamp with an offset.
 * Returns epoch milliseconds. Dates without a time mean 8am local.
 */
export function parseWhen(input: string, now: Date): number {
  const text = input.trim().toLowerCase();
  const rel = /^(?:in\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/.exec(text);
  if (rel) {
    const unit = UNITS[(rel[2] ?? "")[0] ?? ""];
    const n = Number(rel[1]);
    if (unit === undefined || n <= 0) throw bad(input);
    return now.getTime() + n * unit;
  }
  if (/^\d{4}-\d{2}-\d{2}t[\d:.]+(z|[+-]\d{2}:?\d{2})$/.test(text)) {
    const t = Date.parse(input.trim());
    if (Number.isNaN(t)) throw bad(input);
    return t;
  }
  const m = /^(tomorrow|today|[a-z]+|\d{4}-\d{2}-\d{2})(?:[ t]+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/.exec(text);
  if (!m) throw bad(input);
  const [, day = "", hh, mm, ap] = m;
  let hour = DEFAULT_HOUR;
  let minute = 0;
  if (hh !== undefined) {
    if (mm === undefined && ap === undefined) throw bad(input);
    hour = Number(hh);
    minute = mm === undefined ? 0 : Number(mm);
    if (ap) {
      if (hour < 1 || hour > 12) throw bad(input);
      hour = (hour % 12) + (ap === "pm" ? 12 : 0);
    }
    if (hour > 23 || minute > 59) throw bad(input);
  }
  let y = now.getFullYear();
  let mo = now.getMonth();
  let d = now.getDate();
  if (day === "tomorrow" || day === "today") {
    const base = new Date(y, mo, d + (day === "tomorrow" ? 1 : 0));
    [y, mo, d] = [base.getFullYear(), base.getMonth(), base.getDate()];
  } else if (/^\d{4}-/.test(day)) {
    const [ys, ms, ds] = day.split("-").map(Number);
    const check = new Date(ys ?? 0, (ms ?? 1) - 1, ds ?? 1);
    if (check.getMonth() !== (ms ?? 1) - 1) throw bad(input);
    [y, mo, d] = [check.getFullYear(), check.getMonth(), check.getDate()];
  } else {
    const idx = weekdayIndex(day);
    if (idx < 0) throw bad(input);
    const ahead = ((idx - now.getDay() + 7) % 7) || 7;
    const base = new Date(y, mo, d + ahead);
    [y, mo, d] = [base.getFullYear(), base.getMonth(), base.getDate()];
  }
  return new Date(y, mo, d, hour, minute).getTime();
}

/** Like parseWhen, but the result must be in the future. */
export function parseFuture(input: string, now: Date): number {
  const t = parseWhen(input, now);
  if (t <= now.getTime()) throw new FlintError("invalid", `"${input}" is in the past. Pick a later time.`);
  return t;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-26 09:00" in local time. */
export function formatFull(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** List-style: time today, "Oct 24" this year, ISO date before that. */
export function formatShort(ms: number, now: Date): string {
  const d = new Date(ms);
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (d.getFullYear() === now.getFullYear()) return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
