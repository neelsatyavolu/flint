import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGoogleCalendarClient, SCOPE_MISSING_MESSAGE, type CalendarFetch } from "../src/calendar/google";
import type { GoogleCalendarClient, ParsedInvite } from "../src/calendar/contracts";
import { GOOGLE_CALENDAR_SCOPE } from "../src/mail/google-oauth";
import { memorySecrets, type Platform } from "../src/platform";
import { createContext } from "../src/service/context";
import { conflictsFor, connectGoogleCalendar, rsvpViaGoogle } from "../src/service/invites-google";
import { FlintError, type Account } from "../src/types";

type Call = { method: string; url: URL; headers: Record<string, string>; body: unknown };
const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body });

function fakeApi(routes: (c: Call) => ReturnType<typeof reply>): { fetch: CalendarFetch; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call: Call = { method: init?.method ?? "GET", url: new URL(url), headers: init?.headers ?? {}, body: init?.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      return routes(call);
    },
  };
}

const attendees = [
  { email: "boss@example.com", organizer: true, responseStatus: "accepted" },
  { email: "me@gmail.com", self: true, responseStatus: "needsAction" },
  { email: "carla@example.com", responseStatus: "tentative", displayName: "Carla" },
];
const series = { id: "master1", iCalUID: "abc@google.com", etag: '"e1"', recurrence: ["RRULE:FREQ=WEEKLY"], attendees, htmlLink: "https://cal/m" };

describe("Google Calendar client: respond", () => {
  it("finds the event by iCalUID and patches only the self attendee with sendUpdates=all", async () => {
    const api = fakeApi((c) => {
      if (c.method === "GET") return reply(200, { items: [series] });
      return reply(200, { id: "master1", htmlLink: "https://cal/m" });
    });
    const out = await createGoogleCalendarClient({ fetch: api.fetch }).respond({
      accessToken: "AT", uid: "abc@google.com", recurrenceId: null, selfAddresses: ["me@gmail.com"], response: "accepted", comment: "See you",
    });
    expect(out).toEqual({ eventId: "master1", htmlLink: "https://cal/m" });
    expect(api.calls[0]!.url.searchParams.get("iCalUID")).toBe("abc@google.com");
    expect(api.calls[0]!.headers.authorization).toBe("Bearer AT");
    const patch = api.calls[1]!;
    expect(patch.method).toBe("PATCH");
    expect(patch.url.pathname).toMatch(/\/events\/master1$/);
    expect(patch.url.searchParams.get("sendUpdates")).toBe("all");
    expect(patch.headers["if-match"]).toBe('"e1"');
    const sent = (patch.body as { attendees: Record<string, unknown>[] }).attendees;
    expect(sent).toHaveLength(3);
    expect(sent[1]).toMatchObject({ email: "me@gmail.com", responseStatus: "accepted", comment: "See you" });
    expect(sent[2]).toEqual(attendees[2]);
  });

  it("matches the guest by address when Google sets no self flag, case-insensitively", async () => {
    const noSelf = { ...series, attendees: [{ email: "Me@Gmail.com", responseStatus: "needsAction" }] };
    const api = fakeApi((c) => (c.method === "GET" ? reply(200, { items: [noSelf] }) : reply(200, {})));
    await createGoogleCalendarClient({ fetch: api.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: null, selfAddresses: ["me@gmail.com"], response: "declined" });
    expect((api.calls[1]!.body as { attendees: { responseStatus: string }[] }).attendees[0]!.responseStatus).toBe("declined");
  });

  it("answers one occurrence of a series through the instances endpoint", async () => {
    const api = fakeApi((c) => {
      if (c.url.pathname.endsWith("/instances")) {
        return reply(200, { items: [
          { id: "master1_20261020T150000Z", originalStartTime: { dateTime: "2026-10-20T08:00:00-07:00" }, attendees },
          { id: "master1_20261027T150000Z", originalStartTime: { dateTime: "2026-10-27T08:00:00-07:00" }, attendees },
        ] });
      }
      if (c.method === "GET") return reply(200, { items: [series] });
      return reply(200, { id: "master1_20261027T150000Z" });
    });
    const out = await createGoogleCalendarClient({ fetch: api.fetch }).respond({
      accessToken: "t", uid: "abc@google.com", recurrenceId: "20261027T150000Z", selfAddresses: ["me@gmail.com"], response: "tentative",
    });
    expect(out.eventId).toBe("master1_20261027T150000Z");
    expect(api.calls.at(-1)!.url.pathname).toMatch(/master1_20261027T150000Z$/);
  });

  it("uses an edited occurrence that Google returns under the same iCalUID", async () => {
    const exception = { id: "ex1", iCalUID: "abc@google.com", recurringEventId: "master1", originalStartTime: { dateTime: "2026-10-27T15:00:00Z" }, attendees };
    const api = fakeApi((c) => (c.method === "GET" ? reply(200, { items: [series, exception] }) : reply(200, { id: "ex1" })));
    const out = await createGoogleCalendarClient({ fetch: api.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: "20261027T150000Z", selfAddresses: ["me@gmail.com"], response: "accepted" });
    expect(out.eventId).toBe("ex1");
  });

  it("matches an all-day occurrence by date", async () => {
    const api = fakeApi((c) => {
      if (c.url.pathname.endsWith("/instances")) return reply(200, { items: [{ id: "d1", originalStartTime: { date: "2026-10-27" }, attendees }] });
      if (c.method === "GET") return reply(200, { items: [series] });
      return reply(200, { id: "d1" });
    });
    const out = await createGoogleCalendarClient({ fetch: api.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: "20261027", selfAddresses: ["me@gmail.com"], response: "accepted" });
    expect(out.eventId).toBe("d1");
  });

  it("reports not_found when the event or the guest entry is missing", async () => {
    const empty = fakeApi(() => reply(200, { items: [] }));
    await expect(createGoogleCalendarClient({ fetch: empty.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: null, selfAddresses: ["me@gmail.com"], response: "accepted" })).rejects.toMatchObject({ code: "not_found" });
    const other = fakeApi(() => reply(200, { items: [{ ...series, attendees: [{ email: "x@y.z" }] }] }));
    await expect(createGoogleCalendarClient({ fetch: other.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: null, selfAddresses: ["me@gmail.com"], response: "accepted" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("retries once from a fresh read when the event changed (412)", async () => {
    let patches = 0;
    const api = fakeApi((c) => {
      if (c.method === "PATCH") return ++patches === 1 ? reply(412) : reply(200, { id: "master1" });
      return reply(200, c.url.pathname.endsWith("/master1") ? { ...series, etag: '"e2"' } : { items: [series] });
    });
    await createGoogleCalendarClient({ fetch: api.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: null, selfAddresses: ["me@gmail.com"], response: "accepted" });
    expect(patches).toBe(2);
    expect(api.calls.filter((c) => c.method === "PATCH").at(-1)!.headers["if-match"]).toBe('"e2"');
  });

  it.each([
    [401, {}, "auth"],
    [403, { error: { errors: [{ reason: "insufficientPermissions" }], message: "Insufficient Permission" } }, "auth"],
    [403, { error: { errors: [{ reason: "rateLimitExceeded" }] } }, "network"],
    [403, { error: { errors: [{ reason: "accessNotConfigured" }], message: "Google Calendar API has not been used in project 1 before" } }, "invalid"],
    [404, {}, "not_found"],
    [410, {}, "not_found"],
    [429, {}, "network"],
    [503, {}, "network"],
    [400, {}, "invalid"],
  ])("maps HTTP %i to %s", async (status, body, code) => {
    const api = fakeApi(() => reply(status, body));
    await expect(createGoogleCalendarClient({ fetch: api.fetch }).respond({ accessToken: "t", uid: "u", recurrenceId: null, selfAddresses: ["a@b.c"], response: "accepted" })).rejects.toMatchObject({ code });
  });

  it("maps a thrown fetch to network", async () => {
    const down: CalendarFetch = async () => { throw new Error("offline"); };
    await expect(createGoogleCalendarClient({ fetch: down }).listEvents({ accessToken: "t", from: 0, to: 1 })).rejects.toMatchObject({ code: "network" });
  });
});

describe("Google Calendar client: listEvents", () => {
  it("expands single events and leaves out cancelled, declined and free ones", async () => {
    const api = fakeApi(() => reply(200, { items: [
      { id: "1", iCalUID: "a", summary: "Design sync", start: { dateTime: "2026-10-27T15:00:00Z" }, end: { dateTime: "2026-10-27T16:00:00Z" }, attendees: [{ self: true, responseStatus: "accepted" }] },
      { id: "2", summary: "Gone", status: "cancelled", start: { dateTime: "2026-10-27T15:00:00Z" }, end: { dateTime: "2026-10-27T16:00:00Z" } },
      { id: "3", summary: "No thanks", start: { dateTime: "2026-10-27T15:00:00Z" }, end: { dateTime: "2026-10-27T16:00:00Z" }, attendees: [{ self: true, responseStatus: "declined" }] },
      { id: "4", summary: "Holiday", transparency: "transparent", start: { date: "2026-10-27" }, end: { date: "2026-10-28" } },
      { id: "5", summary: "Offsite", start: { date: "2026-10-27" }, end: { date: "2026-10-28" } },
    ] }));
    const events = await createGoogleCalendarClient({ fetch: api.fetch }).listEvents({ accessToken: "t", from: Date.UTC(2026, 9, 27), to: Date.UTC(2026, 9, 28) });
    expect(events.map((e) => e.title)).toEqual(["Design sync", "Offsite"]);
    expect(events[0]).toMatchObject({ start: Date.UTC(2026, 9, 27, 15), selfResponse: "accepted", allDay: false });
    expect(events[1]).toMatchObject({ allDay: true, start: Date.UTC(2026, 9, 27) });
    const q = api.calls[0]!.url.searchParams;
    expect(q.get("singleEvents")).toBe("true");
    expect(q.get("timeMin")).toBe("2026-10-27T00:00:00.000Z");
  });

  it("follows page tokens", async () => {
    let n = 0;
    const api = fakeApi((c) => {
      n++;
      return reply(200, c.url.searchParams.get("pageToken")
        ? { items: [{ id: "b", summary: "B", start: { dateTime: "2026-10-27T17:00:00Z" }, end: { dateTime: "2026-10-27T18:00:00Z" } }] }
        : { items: [{ id: "a", summary: "A", start: { dateTime: "2026-10-27T15:00:00Z" }, end: { dateTime: "2026-10-27T16:00:00Z" } }], nextPageToken: "p2" });
    });
    const events = await createGoogleCalendarClient({ fetch: api.fetch }).listEvents({ accessToken: "t", from: 0, to: 1e13 });
    expect(events.map((e) => e.id)).toEqual(["a", "b"]);
    expect(n).toBe(2);
  });
});

// ---------- service layer ----------

const NOW = Date.UTC(2026, 9, 25, 12);
function setup(hooks: { google?: GoogleCalendarClient; googleAuth?: never } & Record<string, unknown> = {}, accountOver: Partial<Parameters<ReturnType<typeof createContext>["store"]["createAccount"]>[0]> = {}) {
  const secrets = memorySecrets();
  const platform: Platform = {
    dataDir: mkdtempSync(join(tmpdir(), "flint-ig-")), downloadsDir: tmpdir(), secrets, appVersion: "0",
    openExternal: async () => undefined, openPath: async () => undefined, notify: () => undefined,
  };
  const refreshes: URLSearchParams[] = [];
  const ctx = createContext(platform, {
    dbPath: ":memory:", now: () => NOW, googleClient: { clientId: "cid", clientSecret: "sec" },
    fetch: (async (url: string, init?: { body?: string }) => {
      refreshes.push(new URLSearchParams(init?.body ?? ""));
      return { ok: true, status: 200, json: async () => ({ access_token: "FRESH", expires_in: 3600 }) };
    }) as never,
    calendar: hooks as never,
  });
  const account = ctx.store.createAccount({
    email: "me@gmail.com", name: "Me", provider: "gmail", authKind: "oauth_google", username: "me@gmail.com",
    imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true, ...accountOver,
  });
  return { ctx, secrets, account, refreshes };
}
const withScope = (c: ReturnType<typeof setup>) => c.ctx.store.updateAccount(c.account.id, { calendarScope: true });
const saveToken = (c: ReturnType<typeof setup>, expiresAt = NOW + 3_600_000) =>
  c.secrets.set(`account:${c.account.id}`, JSON.stringify({ accessToken: "AT", refreshToken: "RT", expiresAt, scope: GOOGLE_CALENDAR_SCOPE }));

const invite = (over: Partial<ParsedInvite> = {}): ParsedInvite => ({
  uid: "abc@google.com", method: "REQUEST", sequence: 0, recurrenceId: null, title: "Design sync", description: null,
  start: NOW + 3_600_000, end: NOW + 7_200_000, allDay: false, startDate: null, endDate: null, timeZone: "America/Los_Angeles",
  recurrence: null, location: null, url: null, conference: null, organizer: null, attendees: [],
  invitedAs: { address: "Me@Gmail.com", role: "required", rsvp: true }, dtstamp: null, source: "google", googleEventUrl: null, reply: null, ...over,
});

describe("rsvpViaGoogle", () => {
  it("sends the answer with a fresh access token and the user's addresses", async () => {
    const seen: Parameters<GoogleCalendarClient["respond"]>[0][] = [];
    const c = setup({ google: { respond: async (i) => { seen.push(i); return { eventId: "e", htmlLink: null }; }, listEvents: async () => [] } });
    withScope(c);
    await saveToken(c, NOW + 1000); // about to expire, so it refreshes
    const acct = c.ctx.store.requireAccount(c.account.id);
    await rsvpViaGoogle(c.ctx, acct, invite({ recurrenceId: "20261027T150000Z" }), "accepted", "  on my way ");
    expect(c.refreshes[0]!.get("grant_type")).toBe("refresh_token");
    expect(seen[0]).toMatchObject({ accessToken: "FRESH", uid: "abc@google.com", recurrenceId: "20261027T150000Z", response: "accepted", comment: "on my way" });
    expect(seen[0]!.selfAddresses).toEqual(["me@gmail.com"]);
    // the refresh kept the granted scope in the secret
    expect(JSON.parse((await c.secrets.get(`account:${c.account.id}`))!).scope).toBe(GOOGLE_CALENDAR_SCOPE);
  });

  it("refuses without the scope and clears the flag when Google rejects the token", async () => {
    const c = setup({ google: { respond: async () => { throw new FlintError("auth", SCOPE_MISSING_MESSAGE); }, listEvents: async () => [] } });
    await saveToken(c);
    await expect(rsvpViaGoogle(c.ctx, c.ctx.store.requireAccount(c.account.id), invite(), "accepted")).rejects.toMatchObject({ code: "auth" });
    withScope(c);
    await expect(rsvpViaGoogle(c.ctx, c.ctx.store.requireAccount(c.account.id), invite(), "accepted")).rejects.toMatchObject({ code: "auth" });
    expect(c.ctx.store.requireAccount(c.account.id).calendarScope).toBe(false);
  });

  it("keeps the scope flag after a 401, which a token refresh may fix", async () => {
    const c = setup({ google: { respond: async () => { throw new FlintError("auth", "Google Calendar sign-in expired. Connect Google Calendar again."); }, listEvents: async () => { throw new FlintError("auth", "Google Calendar sign-in expired. Connect Google Calendar again."); } } });
    withScope(c); await saveToken(c);
    const acct = () => c.ctx.store.requireAccount(c.account.id);
    await expect(rsvpViaGoogle(c.ctx, acct(), invite(), "accepted")).rejects.toMatchObject({ code: "auth" });
    expect(await conflictsFor(c.ctx, acct(), invite())).toMatchObject({ status: "unknown" });
    expect(acct().calendarScope).toBe(true);
  });

  it("clears the flag when a conflict check hits a missing-scope 403", async () => {
    const c = setup({ google: { respond: async () => ({ eventId: "e", htmlLink: null }), listEvents: async () => { throw new FlintError("auth", SCOPE_MISSING_MESSAGE); } } });
    withScope(c); await saveToken(c);
    await conflictsFor(c.ctx, c.ctx.store.requireAccount(c.account.id), invite());
    expect(c.ctx.store.requireAccount(c.account.id).calendarScope).toBe(false);
  });

  it("passes not_found through so the caller can fall back to iMIP", async () => {
    const c = setup({ google: { respond: async () => { throw new FlintError("not_found", "x"); }, listEvents: async () => [] } });
    withScope(c); await saveToken(c);
    await expect(rsvpViaGoogle(c.ctx, c.ctx.store.requireAccount(c.account.id), invite(), "declined")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("conflictsFor", () => {
  const ev = (over: object) => ({ id: "x", iCalUID: "other", title: "Standup", start: NOW + 3_600_000, end: NOW + 4_500_000, allDay: false, selfResponse: "accepted" as const, htmlLink: null, ...over });

  it("lists overlapping events, ignores the event itself and back-to-back ones, and caches", async () => {
    let calls = 0;
    const c = setup({ google: { respond: async () => ({ eventId: "", htmlLink: null }), listEvents: async () => { calls++; return [ev({}), ev({ iCalUID: "abc@google.com", title: "Itself" }), ev({ id: "y", title: "Earlier", start: NOW, end: NOW + 3_600_000 })]; } } });
    withScope(c); await saveToken(c);
    const acct = c.ctx.store.requireAccount(c.account.id);
    const r = await conflictsFor(c.ctx, acct, invite());
    expect(r).toMatchObject({ status: "conflict", events: [{ title: "Standup" }] });
    await conflictsFor(c.ctx, acct, invite());
    expect(calls).toBe(1);
  });

  it("says free when nothing overlaps", async () => {
    const c = setup({ google: { respond: async () => ({ eventId: "", htmlLink: null }), listEvents: async () => [] } });
    withScope(c); await saveToken(c);
    expect(await conflictsFor(c.ctx, c.ctx.store.requireAccount(c.account.id), invite())).toEqual({ status: "free", checkedAt: NOW });
  });

  it("explains why it cannot check", async () => {
    const hooks = { google: { respond: async () => ({ eventId: "", htmlLink: null }), listEvents: async () => { throw new FlintError("network", "Google Calendar is busy.") } } };
    const noScope = setup(hooks);
    expect(await conflictsFor(noScope.ctx, noScope.account, invite())).toEqual({ status: "unknown", reason: "no-scope" });
    const other = setup(hooks, { authKind: "password", provider: "imap" });
    expect(await conflictsFor(other.ctx, other.account, invite())).toEqual({ status: "unknown", reason: "not-google" });
    const c = setup(hooks);
    withScope(c); await saveToken(c);
    const acct = c.ctx.store.requireAccount(c.account.id);
    expect(await conflictsFor(c.ctx, acct, invite({ allDay: true }))).toMatchObject({ reason: "no-time" });
    expect(await conflictsFor(c.ctx, acct, invite())).toEqual({ status: "unknown", reason: "error", message: "Google Calendar is busy." });
  });
});

describe("connectGoogleCalendar", () => {
  const granted = { email: "me@gmail.com", name: "Me", accessToken: "NEW", refreshToken: "NRT", expiresAt: NOW + 3_600_000, scope: `https://mail.google.com/ openid email ${GOOGLE_CALENDAR_SCOPE}` };

  it("asks incrementally, stores the scope with the new tokens and flags the account", async () => {
    let opts: Record<string, unknown> = {};
    const c = setup({ googleAuth: (async (o: Record<string, unknown>) => { opts = o; return granted; }) as never });
    await saveToken(c);
    const out = await connectGoogleCalendar(c.ctx, c.account.id);
    expect(out.calendarScope).toBe(true);
    expect(opts).toMatchObject({ incremental: { loginHint: "me@gmail.com" }, clientId: "cid" });
    expect(String(opts.scopes)).toContain(GOOGLE_CALENDAR_SCOPE);
    expect(JSON.parse((await c.secrets.get(`account:${c.account.id}`))!)).toMatchObject({ accessToken: "NEW", refreshToken: "NRT", scope: granted.scope });
  });

  it("rejects when the calendar box was unticked or another Google account was chosen", async () => {
    const noCal = setup({ googleAuth: (async () => ({ ...granted, scope: "https://mail.google.com/ openid email" })) as never });
    await expect(connectGoogleCalendar(noCal.ctx, noCal.account.id)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("calendar") });
    expect(noCal.ctx.store.requireAccount(noCal.account.id).calendarScope).toBe(false);
    const wrong = setup({ googleAuth: (async () => ({ ...granted, email: "other@gmail.com" })) as never });
    await expect(connectGoogleCalendar(wrong.ctx, wrong.account.id)).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("other@gmail.com") });
  });

  it("rejects non-Google accounts", async () => {
    const c = setup({}, { authKind: "password", provider: "imap" });
    await expect(connectGoogleCalendar(c.ctx, c.account.id)).rejects.toMatchObject({ code: "invalid" });
  });
});
