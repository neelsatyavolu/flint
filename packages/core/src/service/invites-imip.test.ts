import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarClient, GoogleRespondInput, InviteHooks, ParsedInvite, StoredInvite, StoredResponse } from "../calendar/contracts";
import { SCOPE_MISSING_MESSAGE } from "../calendar/google";
import { FlintError, type Account, type Invite } from "../types";
import type { ServiceContext } from "./context";
import { createRsvp } from "./invites-imip";

const sendUntracked = vi.fn(async (_t: unknown, input: { message: Record<string, unknown> }) => ({ messageId: "m", copies: 1, failed: [], sent: null, input }));
const close = vi.fn();
vi.mock("../mail/send", () => ({ sendUntracked: (t: unknown, i: { message: Record<string, unknown> }) => sendUntracked(t, i) }));
vi.mock("./send", () => ({ openTransport: async () => ({ close }), sentFolders: () => ({ provider: "imap", sentPath: "Sent", trashPath: null }) }));
vi.mock("../mail/connect", () => ({ resolveAuth: async () => ({ user: "me@example.com", accessToken: "tok" }) }));

const NOW = Date.UTC(2026, 9, 25, 12);
const start = Date.UTC(2026, 9, 27, 22);
const parsed: ParsedInvite = {
  uid: "abc@google.com", method: "REQUEST", sequence: 1, recurrenceId: null, title: "Design sync", description: null, start, end: start + 3600_000,
  allDay: false, startDate: null, endDate: null, timeZone: "America/Los_Angeles", recurrence: null, location: null, url: null, conference: null,
  organizer: { name: "Dana", address: "dana@northwind.example" },
  attendees: [{ name: "Neel", address: "me@example.com", response: "needs-action", role: "required", rsvp: true, isYou: true }],
  invitedAs: { address: "me@example.com", role: "required", rsvp: true }, dtstamp: null, source: "google", googleEventUrl: null, reply: null,
};
const merged = (over: Partial<Invite> = {}): Invite => ({ ...parsed, state: "new", yourResponse: "needs-action", respondedAt: null, yourNote: null, changes: [], newerMessageId: null, rsvpVia: "imip", ...over });

function setup(opts: { account?: Partial<Account>; invite?: Partial<Invite>; google?: Partial<GoogleCalendarClient>; sendFails?: boolean; stored?: Partial<ParsedInvite> } = {}) {
  const responses = new Map<string, StoredResponse>();
  const account = { id: "a1", email: "me@example.com", name: "Neel", aliases: [], authKind: "password", calendarScope: false, provider: "imap", ...opts.account } as Account;
  const stored: StoredInvite = { messageId: 5, accountId: "a1", invite: { ...parsed, ...opts.stored }, ics: "", parserVersion: 1, parsedAt: 0 };
  const sent: unknown[] = [];
  const hooks: InviteHooks = {
    sendImip: async (_a, reply) => { if (opts.sendFails) throw new Error("smtp down"); sent.push(reply); },
    google: { respond: vi.fn(async () => ({ eventId: "e1", htmlLink: null })), listEvents: async () => [], ...opts.google } as GoogleCalendarClient,
  };
  const store = {
    getStoredInvite: (id: number) => (id === 5 ? stored : null),
    getResponse: (a: string, uid: string, r: string) => responses.get(`${a}|${uid}|${r}`) ?? null,
    setResponse: (r: StoredResponse) => void responses.set(`${r.accountId}|${r.uid}|${r.recurrenceId}`, r),
    requireAccount: () => account,
    updateAccount: (_id: string, patch: Partial<Account>) => Object.assign(account, patch),
    ownAddresses: () => new Set(["me@example.com"]),
    listCalendarAccountRows: () => [],
  };
  const ctx = { store, invites: hooks, now: () => NOW, emit: vi.fn(), platform: { secrets: {} }, googleClient: () => null, fetch: vi.fn() } as unknown as ServiceContext;
  const reload = vi.fn(async () => {
    const r = responses.get("a1|abc@google.com|");
    return merged({ ...opts.invite, ...(r ? { yourResponse: r.response, yourNote: r.note, respondedAt: r.respondedAt } : {}) });
  });
  return { rsvp: createRsvp(ctx, { reload }), sent, responses, hooks, reload, account };
}

describe("rsvp", () => {
  it("sends an iMIP reply from the invited address to the organizer and records the answer", async () => {
    const t = setup();
    const out = await t.rsvp(5, "accepted", "  see you  ");
    expect(t.sent).toHaveLength(1);
    const reply = t.sent[0] as { from: { address: string }; to: { address: string }; ics: string; subject: string };
    expect(reply.from.address).toBe("me@example.com");
    expect(reply.to.address).toBe("dana@northwind.example");
    expect(reply.subject).toBe("Accepted: Design sync");
    expect(reply.ics).toContain("PARTSTAT=ACCEPTED");
    expect(reply.ics).toContain("COMMENT:see you");
    expect(t.responses.get("a1|abc@google.com|")).toMatchObject({ response: "accepted", note: "see you", via: "imip", sequence: 1, respondedAt: NOW });
    expect(out.yourResponse).toBe("accepted");
  });

  it("is idempotent for the same answer, note and sequence, but sends again when the answer changes", async () => {
    const t = setup();
    await t.rsvp(5, "accepted");
    await t.rsvp(5, "accepted");
    expect(t.sent).toHaveLength(1);
    await t.rsvp(5, "declined");
    expect(t.sent).toHaveLength(2);
  });

  it("shares one send between concurrent identical calls", async () => {
    const t = setup();
    await Promise.all([t.rsvp(5, "tentative"), t.rsvp(5, "tentative")]);
    expect(t.sent).toHaveLength(1);
  });

  it("uses the Google Calendar API when the account has the scope", async () => {
    const respond = vi.fn(async (_i: GoogleRespondInput) => ({ eventId: "e", htmlLink: null }));
    const t = setup({ account: { authKind: "oauth_google", calendarScope: true, provider: "gmail" }, google: { respond } });
    await t.rsvp(5, "declined", "sorry");
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "tok", uid: "abc@google.com", recurrenceId: null, response: "declined", comment: "sorry" }));
    expect(t.sent).toHaveLength(0);
    expect(t.responses.get("a1|abc@google.com|")?.via).toBe("google-calendar");
  });

  it("falls back to iMIP when the event is not on the Google calendar", async () => {
    const respond = vi.fn(async () => { throw new FlintError("not_found", "no"); });
    const t = setup({ account: { authKind: "oauth_google", calendarScope: true }, google: { respond } });
    await t.rsvp(5, "accepted");
    expect(t.sent).toHaveLength(1);
    expect(t.responses.get("a1|abc@google.com|")?.via).toBe("imip");
  });

  it("sends by mail for a Google account without the scope", async () => {
    const respond = vi.fn();
    const t = setup({ account: { authKind: "oauth_google", calendarScope: false }, google: { respond } });
    await t.rsvp(5, "accepted");
    expect(respond).not.toHaveBeenCalled();
    expect(t.sent).toHaveLength(1);
  });

  it("drops the calendar scope when Google says the token lacks it, so the card offers Connect again", async () => {
    const respond = vi.fn(async () => { throw new FlintError("auth", SCOPE_MISSING_MESSAGE); });
    const t = setup({ account: { authKind: "oauth_google", calendarScope: true }, google: { respond } });
    await expect(t.rsvp(5, "accepted")).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("Connect Google Calendar") });
    expect(t.responses.size).toBe(0);
    expect(t.account.calendarScope).toBe(false);
  });

  it("keeps the calendar scope after a plain 401, which the next token refresh may fix", async () => {
    const respond = vi.fn(async () => { throw new FlintError("auth", "Google Calendar sign-in expired. Connect Google Calendar again."); });
    const t = setup({ account: { authKind: "oauth_google", calendarScope: true }, google: { respond } });
    await expect(t.rsvp(5, "accepted")).rejects.toMatchObject({ code: "auth" });
    expect(t.account.calendarScope).toBe(true);
  });

  it("records nothing when the mail fails to send", async () => {
    const t = setup({ sendFails: true });
    await expect(t.rsvp(5, "accepted")).rejects.toMatchObject({ code: "network" });
    expect(t.responses.size).toBe(0);
  });

  it.each([
    ["cancelled", /cancelled/], ["past", /over/], ["superseded", /newer version/], ["reply", /not an invitation/],
  ] as const)("refuses a %s invitation", async (state, msg) => {
    const t = setup({ invite: { state } });
    await expect(t.rsvp(5, "accepted")).rejects.toMatchObject({ code: "invalid", message: expect.stringMatching(msg) });
    expect(t.sent).toHaveLength(0);
  });

  it("refuses unknown messages, bad answers, long notes, and events the user organized", async () => {
    const t = setup();
    await expect(t.rsvp(99, "accepted")).rejects.toMatchObject({ code: "not_found" });
    await expect(t.rsvp(5, "needs-action" as never)).rejects.toMatchObject({ code: "invalid" });
    await expect(t.rsvp(5, "accepted", "x".repeat(2001))).rejects.toMatchObject({ code: "invalid" });
    const own = setup({ stored: { organizer: { name: "Me", address: "ME@example.com" } } });
    await expect(own.rsvp(5, "accepted")).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("organized") });
    const none = setup({ stored: { organizer: null } });
    await expect(none.rsvp(5, "accepted")).rejects.toMatchObject({ code: "invalid" });
    expect(own.sent.length + none.sent.length).toBe(0);
  });
});

describe("realSendImip", () => {
  it("sends one untracked message with a REPLY calendar part and never touches receipts", async () => {
    const { realSendImip } = await import("./invites-imip");
    const receipts = { prepareTracked: vi.fn(), recordUntracked: vi.fn() };
    const ctx = { now: () => NOW, syncs: { get: () => ({}) }, receipts } as unknown as ServiceContext;
    await realSendImip(ctx)({ id: "a1" } as Account, {
      to: { name: "Dana", address: "dana@northwind.example" }, from: { name: "Neel", address: "me@example.com" },
      subject: "Accepted: Design sync", text: "t", html: "<p>t</p>", ics: "BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nEND:VCALENDAR\r\n", uid: "abc@google.com",
    });
    expect(sendUntracked).toHaveBeenCalledTimes(1);
    const message = sendUntracked.mock.calls[0]?.[1].message as { icalEvent: { method: string }; to: unknown[]; html: string };
    expect(message.icalEvent.method).toBe("REPLY");
    expect(message.to).toHaveLength(1);
    expect(message.html).not.toMatch(/<img/);
    expect(receipts.prepareTracked).not.toHaveBeenCalled();
    expect(receipts.recordUntracked).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});
