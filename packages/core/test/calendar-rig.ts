// Shared setup for the calendar-account tests: a real service context on an in-memory database, secrets in memory, a fake
// CalDAV server, a fake Google token endpoint, and an IMAP mail account (the Proton Bridge case) that receives invitations.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import { INVITE_PARSER_VERSION, type GoogleCalendarClient, type GoogleRespondInput, type InviteHooks } from "../src/calendar/contracts";
import { fixture } from "../src/calendar/fixtures";
import { parseInvite } from "../src/calendar/parse";
import { GOOGLE_CALENDAR_SCOPE } from "../src/mail/google-oauth";
import { memorySecrets, type Platform } from "../src/platform";
import { createContext, type ServiceContext } from "../src/service/context";
import { invitesApi } from "../src/service/invites";
import { makeStore, msg, person, seedImap } from "../src/store/testkit";
import type { FlintEvent } from "../src/types";
import { createFakeCaldav, type FakeCaldav, type Flavor } from "./fake-caldav";

export const NOW = Date.UTC(2026, 9, 25, 16);
export const UID = "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com";
/** The fixture invite, as a calendar file (no METHOD). */
export const eventFile = (): string => fixture("google-weekly-meet.ics").replace("METHOD:REQUEST\r\n", "");

export type SentImip = { from: { address: string }; to: { address: string }; subject: string; ics: string };

export type Rig = ReturnType<typeof rig>;

export function rig(o: { username?: string; addresses?: string[]; flavor?: Flavor; scheduling?: boolean; autoSchedule?: boolean; mailAddress?: string; googleCalls?: GoogleRespondInput[]; listEvents?: GoogleCalendarClient["listEvents"]; calendarApi?: (url: string, init?: { body?: string; method?: string; headers?: Record<string, string> }) => { ok: boolean; status: number; json: () => Promise<unknown> } } = {}) {
  const flavor = o.flavor ?? "icloud";
  const username = o.username ?? (flavor === "icloud" ? "appleid@icloud.com" : "me@fastmail.com");
  const fake = createFakeCaldav({ flavor, username, password: "app-pass", scheduling: o.scheduling ?? true, ...(o.autoSchedule === undefined ? {} : { autoSchedule: o.autoSchedule }), addresses: o.addresses ?? [username] });
  const secrets = memorySecrets();
  const platform: Platform = {
    dataDir: mkdtempSync(join(tmpdir(), "flint-cal-")), downloadsDir: tmpdir(), secrets, appVersion: "0",
    openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined,
  };
  const tokenCalls: URLSearchParams[] = [];
  const sent: SentImip[] = [];
  const events: FlintEvent[] = [];
  const google: GoogleCalendarClient = {
    respond: vi.fn(async (i: GoogleRespondInput) => { o.googleCalls?.push(i); return { eventId: "e1", htmlLink: null }; }),
    listEvents: o.listEvents ?? (async () => []),
  };
  // With calendarApi the real Google Calendar client runs against that fake API instead of the mock client.
  const hooks: InviteHooks = { ...(o.calendarApi ? {} : { google }), sendImip: async (_a, reply) => void sent.push(reply as unknown as SentImip) };
  // One fetch for everything the service reaches: Google's token endpoint answers JSON, anything else is the CalDAV server.
  const routed = async (url: string, init?: { body?: string; method?: string; headers?: Record<string, string>; redirect?: "manual" }) => {
    if (url.startsWith("https://oauth2.googleapis.com/")) {
      tokenCalls.push(new URLSearchParams(init?.body ?? ""));
      return { ok: true, status: 200, json: async () => ({ access_token: "FRESH", expires_in: 3600 }) };
    }
    if (o.calendarApi && url.startsWith("https://www.googleapis.com/calendar/")) return o.calendarApi(url, init);
    return fake.fetch(url, init as never);
  };
  const ctx: ServiceContext = createContext(platform, {
    dbPath: ":memory:", now: () => NOW, googleClient: { clientId: "cid", clientSecret: "sec" }, fetch: routed as never, calendar: hooks,
  });
  ctx.bus.subscribe((e) => events.push(e));
  const seed = seedImap(ctx.store, o.mailAddress ?? "me@example.com");
  const api = invitesApi(ctx);
  return { ctx, api, fake, secrets, seed, sent, events, google, tokenCalls, flavor, username, store: ctx.store };
}

/** Ingests the fixture invitation as a message of the IMAP account and stores its parse, as opening the thread would. */
export function receiveInvite(r: Rig, over: { ics?: string; ownAddresses?: string[]; uid?: number } = {}) {
  const ics = over.ics ?? fixture("google-weekly-meet.ics");
  const [o] = r.store.ingestMessages(r.seed.account.id, r.seed.inbox.id, [msg({
    uid: over.uid ?? 5, subject: "Invitation: Design sync", from: [person("Carla Ortiz", "carla@northwind.example")], hasAttachments: true, date: NOW - 86_400_000,
    attachments: [{ part: "2", filename: "invite.ics", contentType: "text/calendar", size: ics.length, contentId: null, inline: false }],
  })]);
  const invite = parseInvite(ics, { ownAddresses: over.ownAddresses ?? [r.seed.account.email], now: NOW })!;
  r.store.saveInvite({ messageId: o!.messageRowId, accountId: r.seed.account.id, invite, ics, parserVersion: INVITE_PARSER_VERSION, parsedAt: NOW });
  return { messageId: o!.messageRowId, invite, ics };
}

export const addICloud = (r: Rig, extra: string[] = ["me@example.com"]) =>
  r.api.addCalDavAccount({ preset: r.flavor, username: r.username, password: "app-pass", extraAddresses: extra });

/** Unfolds an .ics and splits it into lines, for "only this line changed" assertions. */
export const unfold = (ics: string): string[] => ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);

export const googleTokens = (over: Partial<{ accessToken: string; refreshToken: string; expiresAt: number; scope: string }> = {}) =>
  JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt: NOW + 3_600_000, scope: GOOGLE_CALENDAR_SCOPE, ...over });
export type { FakeCaldav };
