import type { AddCalDavAccountInput, AddGoogleCalendarInput, CalendarAccount, Invite } from "@flint/core";
import { CALDAV_PRESETS, FlintError } from "@flint/core/types";
import { ME } from "./people";
import type { MockState } from "./state";

// Demo calendar accounts for the preview. State holds only the rows the user "added"; Gmail sign-ins with the calendar scope are
// derived from the mail accounts, exactly like the real service.

const lower = (a: string): string => a.trim().toLowerCase();
const emailLike = (a: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.trim());

export function mockListCalendars(state: MockState): CalendarAccount[] {
  const implicit: CalendarAccount[] = state.accounts.filter((a) => a.authKind === "oauth_google" && a.calendarScope).map((a) => ({
    id: `mail:${a.id}`, kind: "google", name: a.name || a.email, preset: null, email: a.email, addresses: [...new Set([a.email, ...a.aliases].map(lower))],
    extraAddresses: [], serverUrl: null, username: null, calendarName: null, scheduling: null, status: "ok", statusMessage: null, viaMailAccountId: a.id, createdAt: a.createdAt,
  }));
  return [...state.calendars, ...implicit];
}

const covers = (c: CalendarAccount, address: string): boolean => c.addresses.includes(lower(address));

/** Re-derives how each demo invitation will be answered, after a calendar account was added, changed or removed. */
export function refreshInviteRoutes(state: MockState): void {
  const calendars = mockListCalendars(state);
  state.threads = state.threads.map((t) => ({
    ...t,
    messages: t.messages.map((m) => {
      const inv = m.invite;
      if (!inv || !inv.invitedAs || (inv.rsvpVia !== "imip" && inv.rsvpVia !== "caldav" && inv.rsvpVia !== "google-needs-scope" && inv.rsvpVia !== "google-calendar")) return m;
      const account = state.accounts.find((a) => a.id === t.accountId);
      const mine = calendars.find((c) => covers(c, inv.invitedAs!.address));
      const gmailWithScope = account?.authKind === "oauth_google" && account.calendarScope;
      const via: Invite["rsvpVia"] = gmailWithScope ? "google-calendar" : mine ? (mine.kind === "caldav" ? "caldav" : "google-calendar") : account?.authKind === "oauth_google" ? "google-needs-scope" : "imip";
      return via === inv.rsvpVia ? m : { ...m, invite: { ...inv, rsvpVia: via } };
    }),
  }));
}

export function mockAddGoogleCalendar(state: MockState, input: AddGoogleCalendarInput | undefined, now: number, id: number): CalendarAccount {
  const email = lower(input?.loginHint || ME.orbit);
  const existing = state.calendars.find((c) => c.kind === "google" && c.email === email);
  const extra = (input?.extraAddresses ?? []).map(lower);
  const next: CalendarAccount = {
    id: existing?.id ?? `cal_${id}`, kind: "google", name: input?.name?.trim() || email, preset: null, email, addresses: [...new Set([email, ...extra])], extraAddresses: extra,
    serverUrl: null, username: null, calendarName: null, scheduling: null, status: "ok", statusMessage: null, viaMailAccountId: null, createdAt: existing?.createdAt ?? now,
  };
  state.calendars = existing ? state.calendars.map((c) => (c.id === existing.id ? next : c)) : [...state.calendars, next];
  return next;
}

export function mockAddCalDav(state: MockState, input: AddCalDavAccountInput, now: number, id: number): CalendarAccount {
  const url = input.preset ? CALDAV_PRESETS[input.preset].url : (input.url ?? "").trim();
  if (!url) throw new FlintError("invalid", "Choose iCloud or Fastmail, or enter the server address.");
  if (!/^https:\/\//i.test(url)) throw new FlintError("invalid", "The server address must start with https://.");
  if (!input.username.trim() || !input.password) throw new FlintError("invalid", "Enter the username and the app-specific password.");
  if (input.password === "wrong") throw new FlintError("auth", "The server rejected the username or password.");
  const username = input.username.trim();
  const extra = (input.extraAddresses ?? []).map(lower);
  const email = emailLike(username) ? lower(username) : "";
  const preset = input.preset ?? "custom";
  const existing = state.calendars.find((c) => c.kind === "caldav" && c.serverUrl === url && c.username === username);
  const next: CalendarAccount = {
    id: existing?.id ?? `cal_${id}`, kind: "caldav", name: input.name?.trim() || (input.preset ? CALDAV_PRESETS[input.preset].name : new URL(url).host), preset,
    email, addresses: [...new Set([email, ...extra].filter(Boolean))], extraAddresses: extra, serverUrl: url, username,
    calendarName: preset === "fastmail" ? "Personal" : "Home", scheduling: true, status: "ok", statusMessage: null, viaMailAccountId: null, createdAt: existing?.createdAt ?? now,
  };
  state.calendars = existing ? state.calendars.map((c) => (c.id === existing.id ? next : c)) : [...state.calendars, next];
  return next;
}

export function mockUpdateCalendar(state: MockState, id: string, patch: { name?: string; extraAddresses?: string[] }): CalendarAccount {
  if (id.startsWith("mail:")) throw new FlintError("invalid", "This calendar comes from your Gmail sign-in. Manage it from the mail account in Settings > Accounts.");
  const current = state.calendars.find((c) => c.id === id);
  if (!current) throw new FlintError("not_found", "That calendar account no longer exists.");
  const extra = patch.extraAddresses?.map(lower).filter(Boolean);
  for (const a of extra ?? []) if (!emailLike(a)) throw new FlintError("invalid", `"${a}" is not an email address.`);
  const own = current.email ? [current.email] : [];
  const next: CalendarAccount = {
    ...current, name: patch.name?.trim() || current.name,
    ...(extra ? { extraAddresses: [...new Set(extra)].filter((a) => !own.includes(a)), addresses: [...new Set([...own, ...extra])] } : {}),
  };
  state.calendars = state.calendars.map((c) => (c.id === id ? next : c));
  return next;
}

export function mockRemoveCalendar(state: MockState, id: string): void {
  if (id.startsWith("mail:")) throw new FlintError("invalid", "This calendar comes from your Gmail sign-in. Manage it from the mail account in Settings > Accounts.");
  if (!state.calendars.some((c) => c.id === id)) throw new FlintError("not_found", "That calendar account no longer exists.");
  state.calendars = state.calendars.filter((c) => c.id !== id);
}
