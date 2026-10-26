// Which calendar answers an invitation. The invited address decides: a calendar account that covers it wins over the mail
// account the message arrived on, so mail through Proton Bridge IMAP can still update a Google or iCloud calendar.
import type { ParsedInvite } from "../calendar/contracts";
import type { StoredCalendarAccount } from "../store/calendarAccounts";
import type { Store } from "../store";
import type { Account } from "../types";
import { toCalendarAccount } from "./calendarAccounts";

export type CalendarRoute =
  /** The Gmail sign-in of the mail account itself (it has the calendar scope). */
  | { kind: "google"; via: "mail"; account: Account }
  /** A Google calendar account added in Settings > Calendars. */
  | { kind: "google"; via: "calendar"; row: StoredCalendarAccount }
  | { kind: "caldav"; row: StoredCalendarAccount }
  /** Nobody covers the address: answer by email. `needsGoogleScope` for a Gmail sign-in that could be given the scope. */
  | { kind: "none"; needsGoogleScope: boolean };

const lower = (a: string): string => a.trim().toLowerCase();

/** The addresses the invitation names as the user: the matched invitee first, then any attendee marked as you. */
export function invitedAddresses(invite: Pick<ParsedInvite, "invitedAs" | "attendees">): string[] {
  const list = [invite.invitedAs?.address, ...invite.attendees.filter((a) => a.isYou).map((a) => a.address)].filter((a): a is string => Boolean(a));
  return [...new Set(list.map(lower))];
}

export const mailIdentity = (account: Pick<Account, "email" | "aliases">): string[] => [...new Set([account.email, ...account.aliases].map(lower))];

const googleMail = (a: Account): boolean => a.authKind === "oauth_google" && a.calendarScope;

/** Every address that is "the user" for this invitation: what it names, plus the mail account's own addresses when it names one of them. */
export function selfAddressesOf(account: Account, invite: Pick<ParsedInvite, "invitedAs" | "attendees">, row?: StoredCalendarAccount): string[] {
  const invited = invitedAddresses(invite);
  const identity = mailIdentity(account);
  const ownMail = invited.length === 0 || invited.some((a) => identity.includes(a));
  return [...new Set([...invited, ...(ownMail ? identity : []), ...(row ? toCalendarAccount(row).addresses : [])])];
}

export function resolveRoute(store: Pick<Store, "listCalendarAccountRows">, account: Account, invite: Pick<ParsedInvite, "invitedAs" | "attendees">): CalendarRoute {
  const invited = invitedAddresses(invite);
  const identity = mailIdentity(account);
  const ownMail = invited.length === 0 || invited.some((a) => identity.includes(a));
  if (googleMail(account) && ownMail) return { kind: "google", via: "mail", account };

  const rows = store.listCalendarAccountRows();
  const wanted = ownMail ? [...invited, ...identity] : invited;
  for (const address of wanted) {
    const row = rows.find((r) => toCalendarAccount(r).addresses.includes(address));
    if (row) return row.kind === "google" ? { kind: "google", via: "calendar", row } : { kind: "caldav", row };
  }
  if (googleMail(account)) return { kind: "google", via: "mail", account };
  return { kind: "none", needsGoogleScope: account.authKind === "oauth_google" };
}

/** What rsvpVia says when a calendar account (not the mail account's own scope) answers. Null when none does. */
export function calendarRsvpVia(route: CalendarRoute): "google-calendar" | "caldav" | null {
  return route.kind === "google" ? "google-calendar" : route.kind === "caldav" ? "caldav" : null;
}

/** A stable name for a route in cache keys and logs. */
export function routeKey(route: CalendarRoute): string {
  return route.kind === "google" ? (route.via === "mail" ? `mail:${route.account.id}` : route.row.id) : route.kind === "caldav" ? route.row.id : "none";
}
