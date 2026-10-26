// FROZEN CONTRACTS for calendar invitations. Types only; each area below fills in its side. Change a shape here only
// by agreeing it with the other owners (it is what lets the four areas be built in parallel).
//
// AREA OWNERSHIP (who writes which files)
//  1. parser + storage  calendar/parse.ts, calendar/recurrence.ts, calendar/conference.ts, calendar/zones.ts,
//                       calendar/merge.ts (state/changes/yourResponse), store/invites.ts (InviteStore, mixed into Store),
//                       mail/sync hook that downloads the calendar part during body fetch, service/invites.ts getInvite +
//                       listInvites + toMessageView/ThreadListItem wiring, fixtures in calendar/__fixtures__/*.ics, tests.
//  2. google calendar   calendar/google.ts (GoogleCalendarClient), service/invites-google.ts (rsvp via API, inviteConflicts,
//                       connectGoogleCalendar), mail/google-oauth.ts + mail/connect.ts scope handling, account.calendarScope
//                       upkeep, Settings > Accounts "Connect Google Calendar" wiring in main/ipc.
//  3. imip + CLI        calendar/imip.ts (buildImipReply), service/invites-imip.ts (sendImip over the existing send path),
//                       apps/cli commands "invites" and "rsvp", agent-guide/skill text, CLI tests.
//  4. renderer UI       apps/desktop/src/renderer/src/features/**/InviteCard*.tsx, MessageItem.tsx / ThreadRow.tsx edits,
//                       renderer mock behaviour for rsvp/conflicts/connect (mock/invites.ts), screenshots, renderer tests.
// Shared files (types.ts, api.ts, db/schema.ts, service/context.ts, service/index.ts) are frozen by this change; add only
// via a new migration or a new optional field, and tell the other owners.

import type {
  Account, AccountId, Address, Invite, InviteConflict, InviteResponse, MessageRowId, RsvpResponse,
} from "../types";

/** Fields the parser produces and the database stores (Invite minus what is merged at read time). */
export type ParsedInvite = Omit<Invite, "state" | "yourResponse" | "respondedAt" | "yourNote" | "changes" | "newerMessageId" | "rsvpVia">;

/** Bump when the parser's output changes shape or gets better; stored invites with an older version are re-parsed from `ics` on open. */
export const INVITE_PARSER_VERSION = 2;

/** Which of the user's addresses count as "you" (account email plus aliases, lower case). */
export type ParseContext = { ownAddresses: readonly string[]; now: number };

/**
 * Parses the text of one text/calendar part or .ics file (first VEVENT; VTIMEZONE and TZID, Windows zone names,
 * folded lines and escapes handled). Returns null when it holds no event. Never throws on bad input.
 * IMPLEMENTED BY area 1 as `parseInvite` in calendar/parse.ts.
 */
export type ParseInvite = (ics: string, ctx: ParseContext) => ParsedInvite | null;

// ---------- storage (area 1 implements, everyone else calls it through ctx.store) ----------

export type StoredInvite = {
  messageId: MessageRowId;
  accountId: AccountId;
  invite: ParsedInvite;
  ics: string;
  parserVersion: number;
  parsedAt: number;
};

export type StoredResponse = {
  accountId: AccountId; uid: string; recurrenceId: string;
  response: RsvpResponse; note: string | null; via: "google-calendar" | "caldav" | "imip" | "server"; sequence: number; respondedAt: number;
};

export interface InviteStore {
  saveInvite(input: Omit<StoredInvite, "parsedAt"> & { parsedAt: number }): void;
  getStoredInvite(messageId: MessageRowId): StoredInvite | null;
  /** Marks messages as scanned so non-invite mail is not scanned again. */
  markInviteChecked(messageIds: MessageRowId[]): void;
  /** Messages with a calendar attachment (or part) that have no stored invite and are not marked checked. */
  uncheckedInviteMessages(limit: number): { messageId: MessageRowId; accountId: AccountId }[];
  /** Every stored invite for one event (UID + RECURRENCE-ID; '' = whole event), newest SEQUENCE first. */
  invitesForEvent(accountId: AccountId, uid: string, recurrenceId: string): StoredInvite[];
  getResponse(accountId: AccountId, uid: string, recurrenceId: string): StoredResponse | null;
  setResponse(r: StoredResponse): void;
  /** Newest version per event, not cancelled, ending at or after `from`, starting before `to`, soonest first. */
  upcomingInvites(opts: { accountId?: AccountId; from: number; to: number | null; limit: number }): StoredInvite[];
}

// ---------- Google Calendar (area 2 implements GoogleCalendarClient; area 3 and the service only call it) ----------

export type GoogleCalendarEvent = { id: string; iCalUID: string; title: string; start: number; end: number; allDay: boolean; selfResponse: InviteResponse | null; htmlLink: string | null };

export type GoogleRespondInput = {
  accessToken: string;
  /** The invite's UID (Google's iCalUID). */
  uid: string;
  /** RECURRENCE-ID of the single occurrence to answer, or null to answer the event / whole series. */
  recurrenceId: string | null;
  /** The user's own addresses; the attendee entry that matches one of them (or has self=true) is patched. */
  selfAddresses: readonly string[];
  response: RsvpResponse;
  comment?: string;
};

/**
 * Thin client over https://www.googleapis.com/calendar/v3 on the primary calendar. `fetch` is injected, so tests never reach
 * Google. Throws FlintError: "auth" (401/403 insufficient scope: caller shows Connect Google Calendar), "not_found" (event is
 * not on this calendar: caller falls back to iMIP), "network" (429/5xx/offline).
 */
export interface GoogleCalendarClient {
  /** events.list?iCalUID=… then events.patch with attendees[self].responseStatus and sendUpdates=all (instance lookup via events.instances for recurrence). */
  respond(input: GoogleRespondInput): Promise<{ eventId: string; htmlLink: string | null }>;
  /** events.list on the primary calendar between from and to (epoch ms), single events expanded, cancelled and declined left out. */
  listEvents(input: { accessToken: string; from: number; to: number }): Promise<GoogleCalendarEvent[]>;
}

export type { InviteConflict };

// ---------- iMIP (area 3 implements both) ----------

export type ImipReplyInput = {
  /** The stored invite being answered (UID, SEQUENCE, RECURRENCE-ID, ORGANIZER, SUMMARY, DTSTART are copied from it). */
  invite: ParsedInvite;
  /** The address the user was invited at (From of the reply and the ATTENDEE). */
  attendee: Address;
  response: RsvpResponse;
  note?: string;
  now: number;
};

/** METHOD:REPLY per RFC 5546/6047: subject "Accepted: <title>", text part, and text/calendar; method=REPLY part. Pure; no tracking pixel, no receipts. */
export type BuildImipReply = (input: ImipReplyInput) => { to: Address; subject: string; text: string; html: string; ics: string; uid: string };

/**
 * Sends a built reply from `account` through the existing send path (service/send.ts openTransport + sendUntracked-style
 * delivery, filed in Sent). MUST NOT call receipts.prepareTracked or injectPixel. Tests inject a recorder.
 */
export type SendImip = (account: Account, reply: ReturnType<BuildImipReply> & { from: Address }) => Promise<void>;

/** Slots on ServiceContext. Undefined = use the real implementation; tests inject fakes through ServiceOptions.calendar. */
export type InviteHooks = {
  google?: GoogleCalendarClient;
  sendImip?: SendImip;
  /** Starts Google consent for the calendar scope (tests replace the browser flow). */
  googleAuth?: typeof import("../mail/google-oauth").startGoogleAuth;
};

/** Pure helper both RSVP paths share: the invite's PARTSTAT word for an answer. */
export const PARTSTAT: Record<RsvpResponse, "ACCEPTED" | "TENTATIVE" | "DECLINED"> = {
  accepted: "ACCEPTED", tentative: "TENTATIVE", declined: "DECLINED",
};
