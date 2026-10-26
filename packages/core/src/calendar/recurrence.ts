// Recurrence: a human summary of an RRULE and the next occurrence of a series. ical.js does the rule expansion.
import ICAL from "ical.js";
import { localZone, wallIn, wallToEpoch, type Wall } from "./zones";

export type RuleParts = {
  freq: string; interval: number; byday: { ord: number | null; day: string }[]; bymonthday: number[]; bymonth: number[];
  bysetpos: number[]; count: number | null; until: string | null;
};

const DAY_NAMES: Record<string, string> = { SU: "Sunday", MO: "Monday", TU: "Tuesday", WE: "Wednesday", TH: "Thursday", FR: "Friday", SA: "Saturday" };
const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth"];

const ints = (v: string | undefined): number[] => (v ? v.split(",").map(Number).filter((n) => Number.isInteger(n)) : []);

/** Parses an RRULE value ("FREQ=WEEKLY;BYDAY=TU"). Null when it has no FREQ. */
export function parseRule(rrule: string): RuleParts | null {
  const map = new Map<string, string>();
  for (const piece of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = piece.split("=");
    if (k && v) map.set(k.trim().toUpperCase(), v.trim());
  }
  const freq = map.get("FREQ")?.toUpperCase();
  if (!freq) return null;
  const byday = (map.get("BYDAY") ?? "").split(",").flatMap((d) => {
    const m = /^([+-]?\d)?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d.trim());
    return m ? [{ ord: m[1] ? Number(m[1]) : null, day: m[2]!.toUpperCase() }] : [];
  });
  const count = map.get("COUNT") ? Number(map.get("COUNT")) : null;
  return {
    freq, interval: Math.max(1, Number(map.get("INTERVAL") ?? 1) || 1), byday, bymonthday: ints(map.get("BYMONTHDAY")),
    bymonth: ints(map.get("BYMONTH")), bysetpos: ints(map.get("BYSETPOS")), count: count !== null && Number.isFinite(count) ? count : null,
    until: map.get("UNTIL") ?? null,
  };
}

const ordinalDay = (n: number): string => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
};

const ordinalWord = (n: number): string => (n === -1 ? "last" : n < -1 ? `${ordinalDay(-n)} to last` : ORDINALS[n] ?? ordinalDay(n));

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** UNTIL as a calendar date in the event's zone (a UTC UNTIL can fall on the next day in the zone). */
function untilWall(until: string, zone: string | null): Wall | null {
  const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/.exec(until);
  if (!m) return null;
  const wall: Wall = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +(m[4] ?? 0), minute: +(m[5] ?? 0), second: +(m[6] ?? 0) };
  if (!m[7] || !zone) return wall;
  return wallIn(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second), zone);
}

const shortDate = (w: Wall, withYear: boolean): string => `${MONTHS[w.month - 1]!.slice(0, 3)} ${w.day}${withYear ? `, ${w.year}` : ""}`;

/**
 * "Weekly on Tuesday until Dec 12", "Every weekday", "Every 2 weeks on Monday and Wednesday", "Monthly on the third Friday",
 * "Yearly on Oct 27". `start` is the first occurrence's wall clock in the event's zone.
 */
export function summarizeRecurrence(rrule: string, start: Wall, zone: string | null): string {
  const r = parseRule(rrule);
  if (!r) return "Repeats";
  const startDow = DAY_CODES[new Date(Date.UTC(start.year, start.month - 1, start.day)).getUTCDay()]!;
  const every = (unit: string, n: number): string => (n === 1 ? "" : `Every ${n} ${unit}s`);
  let base: string;
  switch (r.freq) {
    case "DAILY":
      base = r.interval === 1 ? "Daily" : every("day", r.interval);
      break;
    case "WEEKLY": {
      const days = r.byday.length ? r.byday.map((d) => d.day) : [startDow];
      const set = new Set(days);
      if (r.interval === 1 && set.size === 5 && ["MO", "TU", "WE", "TH", "FR"].every((d) => set.has(d))) base = "Every weekday";
      else if (r.interval === 1 && set.size === 7) base = "Daily";
      else {
        const ordered = DAY_CODES.slice(1).concat("SU").filter((d) => set.has(d)).map((d) => DAY_NAMES[d]!);
        base = `${r.interval === 1 ? "Weekly" : every("week", r.interval)} on ${list(ordered)}`;
      }
      break;
    }
    case "MONTHLY": {
      const lead = r.interval === 1 ? "Monthly" : every("month", r.interval);
      const ordDay = r.byday[0]?.ord ?? r.bysetpos[0] ?? null;
      if (r.byday.length && ordDay !== null) base = `${lead} on the ${ordinalWord(ordDay)} ${DAY_NAMES[r.byday[0]!.day]!}`;
      else if (r.bymonthday.length) base = `${lead} on ${list(r.bymonthday.map((d) => (d === -1 ? "the last day" : `the ${ordinalDay(d)}`)))}`;
      else base = `${lead} on the ${ordinalDay(start.day)}`;
      break;
    }
    case "YEARLY": {
      const lead = r.interval === 1 ? "Yearly" : every("year", r.interval);
      const month = r.bymonth[0] ?? start.month;
      if (r.byday.length && (r.byday[0]!.ord ?? r.bysetpos[0]) !== undefined && (r.byday[0]!.ord ?? r.bysetpos[0]) !== null) {
        base = `${lead} on the ${ordinalWord((r.byday[0]!.ord ?? r.bysetpos[0])!)} ${DAY_NAMES[r.byday[0]!.day]!} of ${MONTHS[month - 1]!}`;
      } else base = `${lead} on ${MONTHS[month - 1]!.slice(0, 3)} ${r.bymonthday[0] ?? start.day}`;
      break;
    }
    case "HOURLY": base = r.interval === 1 ? "Hourly" : every("hour", r.interval); break;
    case "MINUTELY": base = every("minute", r.interval) || "Every minute"; break;
    default: base = "Repeats";
  }
  if (r.count !== null) return `${base}, ${r.count === 1 ? "once" : `${r.count} times`}`;
  const until = r.until ? untilWall(r.until, zone) : null;
  return until ? `${base} until ${shortDate(until, until.year !== start.year)}` : base;
}

/**
 * The first occurrence of the series that starts at or after `after` (epoch ms), as an epoch, or null when the series is over.
 * `excluded` (EXDATE) instants are skipped; `added` (RDATE) instants count as occurrences.
 */
export function nextOccurrence(rrule: string, start: Wall, zone: string | null, after: number, excluded: readonly number[] = [], added: readonly number[] = []): number | null {
  const tz = zone ?? localZone();
  const skip = new Set(excluded);
  const extra = added.filter((t) => t >= after && !skip.has(t)).sort((a, b) => a - b)[0] ?? null;
  const pick = (found: number | null): number | null => (found === null ? extra : extra === null ? found : Math.min(found, extra));
  const firstEpoch = wallToEpoch(start, tz);
  if (firstEpoch >= after && !skip.has(firstEpoch)) return pick(firstEpoch);
  let iterator: ICAL.RecurIterator;
  try {
    const recur = ICAL.Recur.fromString(rrule.replace(/^RRULE:/i, ""));
    const dtstart = ICAL.Time.fromData({ year: start.year, month: start.month, day: start.day, hour: start.hour, minute: start.minute, second: start.second, isDate: false });
    iterator = recur.iterator(dtstart);
  } catch {
    return extra;
  }
  for (let i = 0; i < 6000; i++) {
    const t = iterator.next();
    if (!t) return extra;
    const epoch = wallToEpoch({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second }, tz);
    if (epoch >= after && !skip.has(epoch)) return pick(epoch);
  }
  return extra;
}

/** The last instant a series covers, or null when it never ends (or the rule cannot be read). */
export function seriesEnd(rrule: string, start: Wall, zone: string | null, durationMs: number): number | null {
  const r = parseRule(rrule);
  if (!r) return null;
  const tz = zone ?? localZone();
  if (r.until) {
    const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)(Z)?)?$/.exec(r.until);
    if (!m) return null;
    const wall: Wall = { year: +m[1]!, month: +m[2]!, day: +m[3]!, hour: +(m[4] ?? 23), minute: +(m[5] ?? 59), second: +(m[6] ?? 59) };
    return (m[7] ? Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) : wallToEpoch(wall, tz)) + durationMs;
  }
  if (r.count !== null) {
    try {
      const recur = ICAL.Recur.fromString(rrule.replace(/^RRULE:/i, ""));
      const it = recur.iterator(ICAL.Time.fromData({ year: start.year, month: start.month, day: start.day, hour: start.hour, minute: start.minute, second: start.second, isDate: false }));
      let last: ICAL.Time | null = null;
      for (let i = 0; i < Math.min(r.count, 5000); i++) { const t = it.next(); if (!t) break; last = t; }
      if (last) return wallToEpoch({ year: last.year, month: last.month, day: last.day, hour: last.hour, minute: last.minute, second: last.second }, tz) + durationMs;
    } catch { /* fall through */ }
  }
  return null;
}
