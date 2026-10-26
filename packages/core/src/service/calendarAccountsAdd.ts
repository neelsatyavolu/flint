import { CalDavClient, discover, normalizeServerUrl } from "../calendar/caldav";
import { GOOGLE_CALENDAR_ONLY_SCOPES, hasCalendarScope, startGoogleAuth } from "../mail/google-oauth";
import {
  CALDAV_PRESETS, FlintError, type CalDavPreset, type AddCalDavAccountInput, type AddGoogleCalendarInput, type CalendarAccount,
} from "../types";
import { calendarSecretKey, emitCalendarsChanged, parseExtraAddresses, toCalendarAccount } from "./calendarAccounts";
import type { ServiceContext } from "./context";

/**
 * Google consent for the calendar scope only (no Gmail), then a calendar account for whoever signed in. Signing in again
 * as an account that is already added refreshes its sign-in instead of adding a second row.
 */
export async function addGoogleCalendarAccount(ctx: ServiceContext, input: AddGoogleCalendarInput = {}): Promise<CalendarAccount> {
  const client = ctx.googleClient();
  if (!client) throw new FlintError("invalid", "Add a Google client ID and secret in Settings, then try again.");
  const extra = parseExtraAddresses(input.extraAddresses ?? [], []);
  const signIn = await (ctx.invites.googleAuth ?? ctx.options.googleAuth ?? startGoogleAuth)({
    ...client, openExternal: ctx.platform.openExternal, now: ctx.now, scopes: GOOGLE_CALENDAR_ONLY_SCOPES,
    ...(input.loginHint?.trim() ? { loginHint: input.loginHint.trim().toLowerCase() } : {}),
  });
  if (!hasCalendarScope(signIn.scope)) {
    throw new FlintError("invalid", "Google did not give Flint access to your calendar. Try again and leave the calendar box ticked.");
  }
  const email = signIn.email.toLowerCase();
  const existing = ctx.store.listCalendarAccountRows().find((r) => r.kind === "google" && r.email === email);
  const row = existing
    ? ctx.store.updateCalendarAccountRow(existing.id, {
      status: "ok", statusMessage: null, ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(extra.length ? { extraAddresses: [...new Set([...existing.extraAddresses, ...extra])].filter((a) => a !== email) } : {}),
    })!
    : ctx.store.createCalendarAccountRow({
      kind: "google", name: input.name?.trim() || signIn.name || email, email, extraAddresses: extra.filter((a) => a !== email), discoveredAddresses: [],
      preset: null, serverUrl: null, username: null, principalUrl: null, homeUrl: null, outboxUrl: null, defaultCalendarUrl: null,
      defaultCalendarName: null, calendars: [], scheduling: false, createdAt: ctx.now(),
    });
  await ctx.platform.secrets.set(calendarSecretKey(row.id), JSON.stringify({
    accessToken: signIn.accessToken, refreshToken: signIn.refreshToken, expiresAt: signIn.expiresAt, scope: signIn.scope,
  }));
  emitCalendarsChanged(ctx);
  return toCalendarAccount(row);
}

/** Checks the login by discovering the account's calendars first; only then saves the row and the password. */
export async function addCalDavAccount(ctx: ServiceContext, input: AddCalDavAccountInput): Promise<CalendarAccount> {
  const username = input.username?.trim() ?? "";
  if (!username || !input.password) throw new FlintError("invalid", "Enter the username and the app-specific password.");
  if (!input.preset && !input.url?.trim()) throw new FlintError("invalid", "Choose iCloud or Fastmail, or enter the server address.");
  const extra = parseExtraAddresses(input.extraAddresses ?? [], []);
  const preset: CalDavPreset | "custom" = input.preset ?? "custom";
  const serverUrl = input.preset ? CALDAV_PRESETS[input.preset].url : normalizeServerUrl(input.url!);
  const client = new CalDavClient({ fetch: (url, init) => ctx.fetch(url, init), username, password: input.password, serverUrl });
  const found = await discover(client, serverUrl);
  const email = username.includes("@") ? username.toLowerCase() : found.addresses[0] ?? "";
  if (!email && extra.length === 0) {
    throw new FlintError("invalid", "The server did not say which email address this calendar is for. Add the address that receives your invitations.");
  }
  const fields = {
    name: input.name?.trim() || (input.preset ? CALDAV_PRESETS[input.preset].name : new URL(serverUrl).host), email,
    discoveredAddresses: found.addresses, preset, serverUrl, username, principalUrl: found.principalUrl, homeUrl: found.homeUrl, outboxUrl: found.outboxUrl,
    defaultCalendarUrl: found.defaultCalendar.url, defaultCalendarName: found.defaultCalendar.name, calendars: found.calendars,
    scheduling: found.scheduling, status: "ok" as const, statusMessage: null,
  };
  const existing = ctx.store.listCalendarAccountRows().find((r) => r.kind === "caldav" && r.serverUrl === serverUrl && r.username === username);
  const row = existing
    ? ctx.store.updateCalendarAccountRow(existing.id, { ...fields, name: input.name?.trim() || existing.name, extraAddresses: [...new Set([...existing.extraAddresses, ...extra])] })!
    : ctx.store.createCalendarAccountRow({ kind: "caldav", extraAddresses: extra, createdAt: ctx.now(), ...fields });
  await ctx.platform.secrets.set(calendarSecretKey(row.id), JSON.stringify({ password: input.password }));
  emitCalendarsChanged(ctx);
  return toCalendarAccount(row);
}
