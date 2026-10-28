// Answering an invitation on a calendar account (Google or CalDAV) and checking conflicts there, as opposed to the mail
// account's own Gmail sign-in (invites-google.ts). Routing: calendarRouting.ts.
import { discover, eventsBetween, findByUid, putEvent, type CalDavClient, type DiscoveredCalendar, type FoundEvent } from "../calendar/caldav";
import type { ParsedInvite, StoredInvite } from "../calendar/contracts";
import { isScopeMissing } from "../calendar/google";
import { sanitizeForImport, setPartstat, simpleEvents, stripMethod } from "../calendar/icsEdit";
import { localZone } from "../calendar/zones";
import { PARTSTAT } from "../calendar/contracts";
import { logger } from "../log";
import type { StoredCalendarAccount } from "../store/calendarAccounts";
import { FlintError, type Account, type InviteConflicts, type RsvpResponse } from "../types";
import { calendarAccessToken, davClientFor, markStatus } from "./calendarAuth";
import { resolveRoute, routeKey, selfAddressesOf, type CalendarRoute } from "./calendarRouting";
import type { ServiceContext } from "./context";
import { calendarClient, checkConflicts, conflictsFor, noTimeReason, unknown } from "./invites-google";

const log = logger("service.invites-calendars");

// ---------- Google calendar account ----------

export async function rsvpViaGoogleCalendar(
  ctx: ServiceContext, row: StoredCalendarAccount, account: Account, invite: ParsedInvite, response: RsvpResponse, note: string | undefined,
  opts: { addIfMissing?: boolean } = {},
): Promise<{ imported?: true }> {
  const accessToken = await calendarAccessToken(ctx, row);
  try {
    const done = await calendarClient(ctx).respond({
      accessToken, uid: invite.uid, recurrenceId: invite.recurrenceId, selfAddresses: selfAddressesOf(account, invite, row), response,
      ...(note ? { comment: note } : {}), ...(opts.addIfMissing ? { fromInvite: invite } : {}),
    });
    markStatus(ctx, row.id, "ok", null);
    return done.imported ? { imported: true } : {};
  } catch (error) {
    if (isScopeMissing(error)) markStatus(ctx, row.id, "needs-signin", "Flint no longer has permission to use this calendar. Sign in again.");
    throw error;
  }
}

// ---------- CalDAV ----------

/** The calendars to look in, the default first. Re-discovered once when the stored list is empty. */
async function calendarsOf(ctx: ServiceContext, client: CalDavClient, row: StoredCalendarAccount): Promise<DiscoveredCalendar[]> {
  let calendars = row.calendars;
  let def = row.defaultCalendarUrl ? { url: row.defaultCalendarUrl, name: row.defaultCalendarName ?? "Calendar" } : null;
  if (calendars.length === 0 || !def) {
    const found = await discover(client, row.serverUrl!);
    calendars = found.calendars;
    def = found.defaultCalendar;
    ctx.store.updateCalendarAccountRow(row.id, { calendars, defaultCalendarUrl: def.url, defaultCalendarName: def.name, scheduling: found.scheduling });
  }
  return [def, ...calendars.filter((c) => c.url.replace(/\/+$/, "") !== def!.url.replace(/\/+$/, ""))];
}

/** The URL a new event is PUT to: inside the calendar collection even when its href lacks the trailing slash. */
export const newEventUrl = (calendarUrl: string, uid: string): string => new URL(resourceName(uid), calendarUrl.endsWith("/") ? calendarUrl : `${calendarUrl}/`).toString();

const resourceName = (uid: string): string => `${uid.replace(/[^A-Za-z0-9._@=-]/g, "_").slice(0, 120) || "event"}.ics`;
/**
 * True when the server will send the reply to the organizer for this attendee address: it supports scheduling AND knows the
 * address as the user's own (iCloud and Fastmail only schedule for the addresses of the account; an address the user added by
 * hand in Flint is just a name to them).
 */
export const serverReplies = (row: StoredCalendarAccount, address: string): boolean =>
  row.scheduling && [row.email, ...row.discoveredAddresses].some((a) => a && a.toLowerCase() === address.toLowerCase());

const asFlint = (error: unknown, fallback: string): FlintError => (error instanceof FlintError ? error : new FlintError("network", fallback));

/**
 * Sets the user's PARTSTAT on the CalDAV copy of the event (PUT with If-Match on the ETag; everything else in the file is
 * left as the server had it), or adds the event from the invitation when the calendar does not have it yet. With
 * scheduling (RFC 6638) the server then tells the organizer itself.
 * Throws FlintError: "auth" (password rejected), "not_found" (the user is not a guest in the calendar's copy: answer by
 * mail instead), "conflict" (the event kept changing), "network".
 */
export async function rsvpViaCalDav(
  ctx: ServiceContext, row: StoredCalendarAccount, stored: StoredInvite, addresses: readonly string[], response: RsvpResponse,
): Promise<{ created: boolean; changed: boolean; address: string }> {
  const invite = stored.invite;
  const partstat = PARTSTAT[response];
  try {
    const client = await davClientFor(ctx, row);
    const calendars = await calendarsOf(ctx, client, row);
    const edit = { recurrenceId: invite.recurrenceId, addresses, partstat };
    for (let attempt = 0; attempt < 3; attempt++) {
      const found: FoundEvent | null = await findByUid(client, calendars, invite.uid);
      if (!found) {
        // Not in the calendar (the invite was not filed automatically): add it from the invitation with the user's answer.
        // The ICS came from an email: no alarms, attachments or vendor properties go into the user's calendar.
        const clean = sanitizeForImport(stripMethod(stored.ics));
        const made = setPartstat(clean, edit);
        if (made.status === "no-attendee" || made.status === "no-occurrence") throw new FlintError("not_found", "You are not a guest on this event in the calendar.");
        const ics = made.status === "updated" ? made.ics : clean;
        const put = await putEvent(client, newEventUrl(calendars[0]!.url, invite.uid), ics, { ifNoneMatch: true });
        if (put.ok) { markStatus(ctx, row.id, "ok", null); return { created: true, changed: true, address: made.address }; }
        continue; // someone filed it between our search and our write: look again
      }
      const next = setPartstat(found.ics, edit);
      if (next.status === "no-attendee" || next.status === "no-occurrence") throw new FlintError("not_found", "You are not a guest on this event in the calendar.");
      if (next.status === "unchanged") { markStatus(ctx, row.id, "ok", null); return { created: false, changed: false, address: next.address }; }
      const put = await putEvent(client, found.url, next.ics, { ifMatch: found.etag });
      if (put.ok) { markStatus(ctx, row.id, "ok", null); return { created: false, changed: true, address: next.address }; }
    }
    throw new FlintError("conflict", "The event changed while Flint was answering. Try again.");
  } catch (error) {
    if (error instanceof FlintError && error.code === "auth") markStatus(ctx, row.id, "needs-signin", error.message);
    throw asFlint(error, "Could not reach the calendar server.");
  }
}

async function caldavEvents(ctx: ServiceContext, row: StoredCalendarAccount, invite: ParsedInvite, addresses: readonly string[]) {
  const client = await davClientFor(ctx, row);
  const [def] = await calendarsOf(ctx, client, row);
  const zone = localZone();
  const out = [];
  for (const ics of await eventsBetween(client, def!.url, invite.start, invite.end)) {
    for (const e of simpleEvents(ics, addresses, zone)) {
      if (e.uid === invite.uid) continue; // the invited event itself never clashes with itself
      // A series master in the answer means the server ignored the expand request: the clash list would silently miss it.
      if (e.recurring && !e.recurrenceOverride) throw new FlintError("invalid", "Your calendar server did not expand repeating events, so Flint could not check them for clashes.");
      // Cancelled, "free" and declined events do not block time.
      if (e.status === "CANCELLED" || e.transparent || e.selfDeclined) continue;
      out.push({ uid: e.uid, title: e.title, start: e.start, end: e.end, allDay: e.allDay });
    }
  }
  return out;
}

// ---------- conflicts ----------

/** Overlap with the calendar that covers the invited address. Never throws. */
export async function inviteConflictsFor(ctx: ServiceContext, account: Account, invite: ParsedInvite, route?: CalendarRoute): Promise<InviteConflicts> {
  const r = route ?? resolveRoute(ctx.store, account, invite);
  if (r.kind === "none") return r.needsGoogleScope ? unknown("no-scope") : unknown("no-calendar");
  if (r.kind === "google" && r.via === "mail") return conflictsFor(ctx, r.account, invite);
  const none = noTimeReason(invite);
  if (none) return unknown(none);
  if (r.kind === "google") {
    const row = r.row;
    return checkConflicts(
      ctx, routeKey(r), invite,
      async () => (await calendarClient(ctx).listEvents({ accessToken: await calendarAccessToken(ctx, row), from: invite.start, to: invite.end }))
        .map((e) => ({ uid: e.iCalUID, title: e.title, start: e.start, end: e.end, allDay: e.allDay })),
      (error) => { if (isScopeMissing(error)) markStatus(ctx, row.id, "needs-signin", error.message); },
    );
  }
  const row = r.row;
  log.debug("checking conflicts on CalDAV", { calendar: row.id });
  return checkConflicts(
    ctx, routeKey(r), invite, () => caldavEvents(ctx, row, invite, selfAddressesOf(account, invite, row)),
    (error) => markStatus(ctx, row.id, "needs-signin", error.message),
  );
}
