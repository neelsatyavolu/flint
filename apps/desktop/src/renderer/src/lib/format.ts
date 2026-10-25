import { differenceInCalendarDays, format, isSameDay, isSameYear, startOfWeek, subDays } from "date-fns";
import type { Address } from "@flint/core";

/** List time like Spark: "3:49 PM" today, "Tue" within the week, "Oct 23" this year, else "Oct 23, 2024". */
export function formatListTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (isSameDay(d, n)) return format(d, "h:mm a");
  const diff = differenceInCalendarDays(n, d);
  if (diff > 0 && diff < 7) return format(d, "EEE");
  if (isSameYear(d, n)) return format(d, "MMM d");
  return format(d, "MMM d, yyyy");
}

/** Message header time: "Oct 23, 2026, 3:49 PM". */
export function formatFullDate(ts: number): string {
  return format(new Date(ts), "MMM d, yyyy, h:mm a");
}

/** Group label for list sections. Uppercase; the Label style also uppercases. */
export function dateGroupLabel(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  if (isSameDay(d, n)) return "TODAY";
  if (isSameDay(d, subDays(n, 1))) return "YESTERDAY";
  const weekStart = startOfWeek(n, { weekStartsOn: 1 });
  if (d >= weekStart) return "THIS WEEK";
  if (d >= subDays(weekStart, 7)) return "LAST WEEK";
  if (isSameYear(d, n)) return format(d, "MMMM").toUpperCase();
  return format(d, "yyyy");
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const text = value >= 10 ? Math.round(value).toString() : value.toFixed(1).replace(/\.0$/, "");
  return `${text} ${units[i]}`;
}

/** Name to show for one address: the display name, else the local part. */
export function displayName(addr: Address): string {
  const name = addr.name.trim();
  if (name) return name;
  return addr.address.split("@")[0] ?? addr.address;
}

export function firstName(addr: Address): string {
  return displayName(addr).split(/\s+/)[0] ?? displayName(addr);
}

/**
 * Sender line for a thread row. One participant shows the full display name;
 * several show first names ("Carla, Rodney"), with "+N" when over `max`.
 */
export function formatParticipants(list: Address[], max = 3): string {
  const seen = new Set<string>();
  const unique = list.filter((a) => {
    const k = a.address.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length === 0) return "";
  if (unique.length === 1) return displayName(unique[0]!);
  const names = unique.slice(0, max).map(firstName);
  const extra = unique.length - max;
  return extra > 0 ? `${names.join(", ")} +${extra}` : names.join(", ");
}

/** "Name <address>" for recipient fields. */
export function formatAddress(addr: Address): string {
  return addr.name.trim() ? `${addr.name.trim()} <${addr.address}>` : addr.address;
}

/** Recipients line: "to me, Carla". */
export function formatRecipients(to: Address[], selfAddresses: string[] = []): string {
  const selves = new Set(selfAddresses.map((s) => s.toLowerCase()));
  const names = to.map((a) => (selves.has(a.address.toLowerCase()) ? "me" : firstName(a)));
  return names.length ? `to ${names.join(", ")}` : "";
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
