import { addDays, format, isSameDay, set } from "date-fns";

export type PresetId = "later" | "tomorrow" | "weekend" | "nextWeek";
export type TimePreset = { id: PresetId; label: string; at: number };

const atHour = (d: Date, hour: number, minute = 0) => set(d, { hours: hour, minutes: minute, seconds: 0, milliseconds: 0 });

/**
 * Presets for snooze, send later and reminders. Pure: pass `now`.
 * - Later today: three hours out, rounded up to the half hour; dropped when it would pass 22:00.
 * - Tomorrow: tomorrow 8:00.
 * - This weekend: the coming Saturday 9:00; dropped on Saturday and Sunday.
 * - Next week: the coming Monday 8:00.
 */
export function resolvePresets(now: Date | number): TimePreset[] {
  const n = typeof now === "number" ? new Date(now) : now;
  const presets: TimePreset[] = [];

  const plus3 = new Date(n.getTime() + 3 * 3600_000);
  const rounded = set(plus3, {
    minutes: plus3.getMinutes() === 0 ? 0 : plus3.getMinutes() <= 30 ? 30 : 60,
    seconds: 0,
    milliseconds: 0,
  });
  if (isSameDay(rounded, n) && rounded.getHours() < 22) {
    presets.push({ id: "later", label: "Later today", at: rounded.getTime() });
  }

  presets.push({ id: "tomorrow", label: "Tomorrow morning", at: atHour(addDays(n, 1), 8).getTime() });

  const dow = n.getDay(); // 0 Sun .. 6 Sat
  if (dow >= 1 && dow <= 5) {
    presets.push({ id: "weekend", label: "This weekend", at: atHour(addDays(n, 6 - dow), 9).getTime() });
  }

  const daysToMonday = ((8 - dow) % 7) || 7;
  presets.push({ id: "nextWeek", label: "Next week", at: atHour(addDays(n, daysToMonday), 8).getTime() });

  return presets;
}

/** Resolved time shown at the right of a preset: "6:00 PM" today, "Tue 8:00 AM" within a week, else "Nov 3, 8:00 AM". */
export function formatPresetTime(at: number, now: Date | number = Date.now()): string {
  const n = typeof now === "number" ? new Date(now) : now;
  const d = new Date(at);
  if (isSameDay(d, n)) return format(d, "h:mm a");
  const days = Math.round((atHour(d, 0).getTime() - atHour(n, 0).getTime()) / 86400_000);
  if (days > 0 && days < 7) return format(d, "EEE h:mm a");
  return format(d, "MMM d, h:mm a");
}

/** Parses the value of an <input type="datetime-local"> in local time. Returns null when empty or invalid. */
export function parseLocalInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Formats a timestamp for <input type="datetime-local">. */
export function toLocalInput(at: number): string {
  return format(new Date(at), "yyyy-MM-dd'T'HH:mm");
}
