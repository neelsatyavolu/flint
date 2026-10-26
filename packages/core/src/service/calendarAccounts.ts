// Calendar accounts (Settings > Calendars): where invitations get answered, independent of the mail account they arrived on.
// Google rows hold tokens and CalDAV rows a password in platform.secrets under calendar:<id>; the database never sees either.
import type { StoredCalendarAccount } from "../store/calendarAccounts";
import { FlintError, type Account, type CalendarAccount } from "../types";
import type { ServiceContext } from "./context";

export const calendarSecretKey = (id: string): string => `calendar:${id}`;
export const IMPLICIT_PREFIX = "mail:";

const lower = (a: string): string => a.trim().toLowerCase();
const unique = (list: readonly string[]): string[] => [...new Set(list.map(lower).filter((a) => a.includes("@")))];

/** Public shape of a stored row. */
export function toCalendarAccount(row: StoredCalendarAccount): CalendarAccount {
  const own = row.kind === "google" || row.email.includes("@") ? [row.email] : [];
  return {
    id: row.id, kind: row.kind, name: row.name, preset: row.preset, email: row.email || row.discoveredAddresses[0] || "",
    addresses: unique([...own, ...row.discoveredAddresses, ...row.extraAddresses]), extraAddresses: [...row.extraAddresses],
    serverUrl: row.serverUrl, username: row.username, calendarName: row.kind === "caldav" ? row.defaultCalendarName : null,
    scheduling: row.kind === "caldav" ? row.scheduling : null, status: row.status, statusMessage: row.statusMessage,
    viaMailAccountId: null, createdAt: row.createdAt,
  };
}

/** The implicit entry for a Gmail sign-in that has the calendar scope: covers its own address and aliases. */
export function implicitCalendar(account: Account): CalendarAccount {
  return {
    id: `${IMPLICIT_PREFIX}${account.id}`, kind: "google", name: account.name || account.email, preset: null, email: account.email,
    addresses: unique([account.email, ...account.aliases]), extraAddresses: [], serverUrl: null, username: null, calendarName: null,
    scheduling: null, status: "ok", statusMessage: null, viaMailAccountId: account.id, createdAt: account.createdAt,
  };
}

/** Gmail sign-ins that count as a calendar account for their own addresses. */
export const hasMailCalendar = (a: Account): boolean => a.authKind === "oauth_google" && a.calendarScope;

export function listCalendarAccounts(ctx: ServiceContext): CalendarAccount[] {
  const mail = ctx.store.listAccounts().filter(hasMailCalendar).map(implicitCalendar);
  return [...ctx.store.listCalendarAccountRows().map(toCalendarAccount), ...mail];
}

/** Tells the UI (and cached message views) that routes for invitations may have changed. */
export function emitCalendarsChanged(ctx: ServiceContext): void {
  for (const a of ctx.store.listAccounts()) ctx.emit({ type: "mail_changed", accountId: a.id, threadIds: [] });
}

function requireRow(ctx: ServiceContext, id: string): StoredCalendarAccount {
  if (id.startsWith(IMPLICIT_PREFIX)) throw new FlintError("invalid", "This calendar comes from your Gmail sign-in. Manage it from the mail account in Settings > Accounts.");
  const row = ctx.store.getCalendarAccountRow(id);
  if (!row) throw new FlintError("not_found", "That calendar account no longer exists.");
  return row;
}

export function parseExtraAddresses(list: readonly string[], own: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const a = lower(raw);
    if (!a) continue;
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a)) throw new FlintError("invalid", `"${raw.trim()}" is not an email address.`);
    if (!own.includes(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

export function updateCalendarAccount(ctx: ServiceContext, id: string, patch: { name?: string; extraAddresses?: string[] }): CalendarAccount {
  const row = requireRow(ctx, id);
  const own = toCalendarAccount({ ...row, extraAddresses: [] }).addresses;
  const next = ctx.store.updateCalendarAccountRow(id, {
    ...(patch.name !== undefined ? { name: patch.name.trim() || row.name } : {}),
    ...(patch.extraAddresses !== undefined ? { extraAddresses: parseExtraAddresses(patch.extraAddresses, own) } : {}),
  })!;
  emitCalendarsChanged(ctx);
  return toCalendarAccount(next);
}

export async function removeCalendarAccount(ctx: ServiceContext, id: string): Promise<void> {
  requireRow(ctx, id);
  await ctx.platform.secrets.delete(calendarSecretKey(id));
  ctx.store.deleteCalendarAccountRow(id);
  emitCalendarsChanged(ctx);
}
