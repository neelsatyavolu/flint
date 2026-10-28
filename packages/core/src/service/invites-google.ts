import { createGoogleCalendarClient, isScopeMissing } from "../calendar/google";
import type { GoogleCalendarClient, ParsedInvite } from "../calendar/contracts";
import { logger } from "../log";
import { resolveAuth, secretKey } from "../mail/connect";
import { GOOGLE_SCOPES, hasCalendarScope, startGoogleAuth } from "../mail/google-oauth";
import { FlintError, type Account, type AccountId, type InviteConflicts, type RsvpResponse } from "../types";
import type { ServiceContext } from "./context";

const log = logger("service.invites-google");

/** How long a conflict check stays valid. Short, so a freshly accepted event shows up on the next look. */
export const CONFLICT_CACHE_MS = 2 * 60 * 1000;

/** The Calendar client for this context: an injected fake in tests, else the real API over ctx.fetch. */
export function calendarClient(ctx: ServiceContext): GoogleCalendarClient {
  return ctx.invites.google ?? createGoogleCalendarClient({ fetch: (url, init) => ctx.fetch(url, init) });
}

/** True when RSVPs and conflict checks for this account can use the Calendar API. */
export const canUseGoogleCalendar = (account: Account): boolean => account.authKind === "oauth_google" && account.calendarScope;

/** A fresh access token for the account (refreshed when it is about to expire, like mail sync does). */
export function accessTokenFor(ctx: ServiceContext, account: Account): Promise<string> {
  return resolveAuth(account, {
    secrets: ctx.platform.secrets,
    google: () => ctx.googleClient() ?? { clientId: "", clientSecret: "" },
    fetch: (url, init) => ctx.fetch(url, init),
    now: ctx.now,
  }).then((auth) => {
    if (!("accessToken" in auth)) throw new FlintError("auth", "This account is not signed in with Google.");
    return auth.accessToken;
  });
}

/** The user's addresses on this account, lower case: the one it was invited at first. */
export function selfAddresses(account: Account, invite: ParsedInvite): string[] {
  const all = [invite.invitedAs?.address, account.email, ...account.aliases].filter((a): a is string => Boolean(a)).map((a) => a.toLowerCase());
  return [...new Set(all)];
}

/** The Calendar API refused the token: the grant is gone or never had the scope. Flip the flag so the card offers Connect again. */
function dropCalendarScope(ctx: ServiceContext, account: Account): void {
  ctx.store.updateAccount(account.id, { calendarScope: false });
  ctx.emit({ type: "mail_changed", accountId: account.id, threadIds: [] });
}

/**
 * Answers an invite through the Google Calendar API (patches your attendee entry, Google emails the organizer).
 * Throws FlintError: "auth" (no scope or sign-in expired, the card shows Connect), "not_found" (the event is not on this
 * calendar, so the caller falls back to an iMIP reply), "network", "invalid".
 */
export async function rsvpViaGoogle(
  ctx: ServiceContext, account: Account, invite: ParsedInvite, response: RsvpResponse, note?: string, opts: { addIfMissing?: boolean } = {},
): Promise<{ eventId: string; htmlLink: string | null; imported?: true }> {
  if (!canUseGoogleCalendar(account)) throw new FlintError("auth", "Connect Google Calendar to answer from Flint.");
  const accessToken = await accessTokenFor(ctx, account);
  try {
    return await calendarClient(ctx).respond({
      accessToken, uid: invite.uid, recurrenceId: invite.recurrenceId, selfAddresses: selfAddresses(account, invite), response,
      ...(note?.trim() ? { comment: note.trim() } : {}), ...(opts.addIfMissing ? { fromInvite: invite } : {}),
    });
  } catch (error) {
    if (isScopeMissing(error)) dropCalendarScope(ctx, account);
    throw error;
  }
}

export const unknown = (reason: "no-scope" | "no-calendar" | "no-time" | "error", message?: string): InviteConflicts =>
  ({ status: "unknown", reason, ...(message ? { message } : {}) });

/** Events that clash with the invite: strict overlap (back-to-back is fine), and the event being answered never clashes with itself. */
export type CalendarEventLite = { uid: string; title: string; start: number; end: number; allDay: boolean };

/** Why an invite has no time to compare, or null when it has one. */
export const noTimeReason = (invite: ParsedInvite): "no-time" | null =>
  invite.allDay || !(invite.end > invite.start) || invite.method === "CANCEL" || invite.method === "REPLY" ? "no-time" : null;

/**
 * Looks for overlap with the events `load` returns, caching the answer for CONFLICT_CACHE_MS per source, event and time.
 * Never throws: problems become status "unknown". `onAuthError` runs for an "auth" FlintError and returns whether the
 * reason is a missing calendar permission ("no-scope") rather than something the next attempt may fix.
 */
export async function checkConflicts(
  ctx: ServiceContext, source: string, invite: ParsedInvite, load: () => Promise<CalendarEventLite[]>, onAuthError: (e: FlintError) => void,
): Promise<InviteConflicts> {
  const key = `inviteConflicts:${source}:${invite.uid}:${invite.recurrenceId ?? ""}:${invite.start}:${invite.end}`;
  const cached = ctx.store.kvGet(key, ctx.now());
  if (cached) {
    try { return JSON.parse(cached) as InviteConflicts; } catch { /* fall through and look again */ }
  }
  try {
    const clashes = (await load())
      .filter((e) => e.start < invite.end && e.end > invite.start && e.uid !== invite.uid)
      .map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay }));
    const checkedAt = ctx.now();
    const result: InviteConflicts = clashes.length ? { status: "conflict", checkedAt, events: clashes } : { status: "free", checkedAt };
    ctx.store.kvSet(key, JSON.stringify(result), CONFLICT_CACHE_MS, ctx.now());
    return result;
  } catch (error) {
    if (error instanceof FlintError && error.code === "auth") {
      onAuthError(error);
      return unknown("no-scope", error.message);
    }
    log.info("conflict check failed", { reason: (error as Error).message });
    return unknown("error", error instanceof FlintError ? error.message : "Could not check your calendar.");
  }
}

/**
 * Overlap of the invite's time with the primary calendar. Never throws: Google problems become status "unknown".
 * Results are cached for CONFLICT_CACHE_MS per event, time and account.
 */
export async function conflictsFor(ctx: ServiceContext, account: Account, invite: ParsedInvite): Promise<InviteConflicts> {
  if (account.authKind !== "oauth_google") return { status: "unknown", reason: "not-google" };
  if (!account.calendarScope) return unknown("no-scope");
  const none = noTimeReason(invite);
  if (none) return unknown(none);
  return checkConflicts(
    ctx, account.id, invite,
    async () => (await calendarClient(ctx).listEvents({ accessToken: await accessTokenFor(ctx, account), from: invite.start, to: invite.end }))
      .map((e) => ({ uid: e.iCalUID, title: e.title, start: e.start, end: e.end, allDay: e.allDay })),
    // Only a 403 for a missing scope means the grant lost it; a 401 may be a token that the next refresh fixes.
    (error) => { if (isScopeMissing(error)) dropCalendarScope(ctx, account); },
  );
}

/**
 * Runs Google's consent screen for the Calendar scope on an existing Google account (include_granted_scopes), then
 * stores the granted scope with the tokens and flags the account. Resolves with the updated account.
 */
export async function connectGoogleCalendar(ctx: ServiceContext, accountId: AccountId): Promise<Account> {
  const account = ctx.store.requireAccount(accountId);
  if (account.authKind !== "oauth_google") throw new FlintError("invalid", "Only accounts signed in with Google can connect Google Calendar.");
  const client = ctx.googleClient();
  if (!client) throw new FlintError("invalid", "Add a Google client ID and secret in Settings, then try again.");
  const signIn = await (ctx.invites.googleAuth ?? ctx.options.googleAuth ?? startGoogleAuth)({
    ...client, openExternal: ctx.platform.openExternal, now: ctx.now, scopes: GOOGLE_SCOPES, incremental: { loginHint: account.email },
  });
  const wanted = new Set([account.email, ...account.aliases].map((a) => a.toLowerCase()));
  if (!wanted.has(signIn.email.toLowerCase())) {
    throw new FlintError("invalid", `You signed in as ${signIn.email}, but this account is ${account.email}. Choose ${account.email} in the Google window.`);
  }
  if (!hasCalendarScope(signIn.scope)) {
    throw new FlintError("invalid", "Google did not give Flint access to your calendar. Try again and leave the calendar box ticked.");
  }
  await ctx.platform.secrets.set(secretKey(account.id), JSON.stringify({
    accessToken: signIn.accessToken, refreshToken: signIn.refreshToken, expiresAt: signIn.expiresAt, scope: signIn.scope,
  }));
  const updated = ctx.store.updateAccount(account.id, { calendarScope: true });
  ctx.emit({ type: "mail_changed", accountId: account.id, threadIds: [] });
  return updated;
}
