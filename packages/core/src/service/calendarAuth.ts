import { CalDavClient } from "../calendar/caldav";
import { secretSchema } from "../mail/connect";
import { refreshGoogleToken, REFRESH_MARGIN_MS } from "../mail/google-oauth";
import type { StoredCalendarAccount } from "../store/calendarAccounts";
import { FlintError } from "../types";
import { calendarSecretKey, emitCalendarsChanged } from "./calendarAccounts";
import type { ServiceContext } from "./context";

/** Records that a calendar account works or needs attention; tells the UI only when that changed. */
export function markStatus(ctx: ServiceContext, id: string, status: StoredCalendarAccount["status"], message: string | null): void {
  const row = ctx.store.getCalendarAccountRow(id);
  if (!row || (row.status === status && row.statusMessage === message)) return;
  ctx.store.updateCalendarAccountRow(id, { status, statusMessage: message });
  emitCalendarsChanged(ctx);
}

async function readSecret(ctx: ServiceContext, row: StoredCalendarAccount) {
  const raw = await ctx.platform.secrets.get(calendarSecretKey(row.id));
  if (!raw) {
    markStatus(ctx, row.id, "needs-signin", "The saved sign-in is missing. Sign in again.");
    throw new FlintError("auth", "The saved sign-in for this calendar is missing. Add it again in Settings > Calendars.");
  }
  try {
    return secretSchema.parse(JSON.parse(raw));
  } catch {
    markStatus(ctx, row.id, "needs-signin", "The saved sign-in is unreadable. Sign in again.");
    throw new FlintError("auth", "The saved sign-in for this calendar is unreadable. Add it again in Settings > Calendars.");
  }
}

/** A fresh Google access token for a Google calendar account, refreshed like the Gmail tokens are. */
export async function calendarAccessToken(ctx: ServiceContext, row: StoredCalendarAccount): Promise<string> {
  const secret = await readSecret(ctx, row);
  if ("password" in secret) throw new FlintError("auth", "This calendar is not signed in with Google.");
  if (secret.expiresAt - ctx.now() > REFRESH_MARGIN_MS) return secret.accessToken;
  const client = ctx.googleClient();
  if (!client?.clientId || !client.clientSecret) throw new FlintError("auth", "Add a Google client ID and secret in Settings, then sign in again.");
  try {
    const next = await refreshGoogleToken({ ...client, refreshToken: secret.refreshToken, fetch: (url, init) => ctx.fetch(url, init), now: ctx.now });
    await ctx.platform.secrets.set(calendarSecretKey(row.id), JSON.stringify(secret.scope ? { ...next, scope: secret.scope } : next));
    return next.accessToken;
  } catch (error) {
    if (error instanceof FlintError && error.code === "auth") markStatus(ctx, row.id, "needs-signin", error.message);
    throw error;
  }
}

/** A CalDAV client for a saved account (password from the secret store). */
export async function davClientFor(ctx: ServiceContext, row: StoredCalendarAccount): Promise<CalDavClient> {
  const secret = await readSecret(ctx, row);
  if (!("password" in secret) || !row.serverUrl || !row.username) throw new FlintError("auth", "This calendar has no saved password. Add it again in Settings > Calendars.");
  return new CalDavClient({ fetch: (url, init) => ctx.fetch(url, init), username: row.username, password: secret.password, serverUrl: row.serverUrl });
}
