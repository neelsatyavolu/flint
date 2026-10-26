import { describe, expect, it } from "vitest";
import { INVITE_PARSER_VERSION } from "../calendar/contracts";
import { NOW, parsed } from "../calendar/fixtures";
import { makeStore, msg, seedImap } from "./testkit";

const att = (name: string, type = "text/calendar") => [{ part: "2", filename: name, contentType: type, size: 10, contentId: null, inline: false }];

function setup() {
  const store = makeStore();
  const s = seedImap(store);
  const add = (uid: number, attachments: ReturnType<typeof att>) => store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid, attachments, hasAttachments: true })])[0]!.messageRowId;
  return { store, accountId: s.account.id, add, inbox: s.inbox };
}

describe("InvitesRepo", () => {
  it("round-trips an invite and marks the message scanned", () => {
    const { store, accountId, add } = setup();
    const id = add(1, att("invite.ics"));
    expect(store.getStoredInvite(id)).toBeNull();
    const invite = parsed("google-weekly-meet.ics");
    store.saveInvite({ messageId: id, accountId, invite, ics: "ICS TEXT", parserVersion: INVITE_PARSER_VERSION, parsedAt: NOW });
    expect(store.getStoredInvite(id)).toEqual({ messageId: id, accountId, invite, ics: "ICS TEXT", parserVersion: INVITE_PARSER_VERSION, parsedAt: NOW });
    expect(store.isInviteChecked(id)).toBe(true);
  });

  it("replaces the stored invite when saved again", () => {
    const { store, accountId, add } = setup();
    const id = add(1, att("invite.ics"));
    const v0 = parsed("brand-review-v0.ics");
    store.saveInvite({ messageId: id, accountId, invite: v0, ics: "a", parserVersion: 1, parsedAt: 1 });
    store.saveInvite({ messageId: id, accountId, invite: { ...v0, title: "Renamed" }, ics: "b", parserVersion: 2, parsedAt: 2 });
    expect(store.getStoredInvite(id)).toMatchObject({ ics: "b", parserVersion: 2, invite: { title: "Renamed" } });
  });

  it("lists unscanned messages that carry a calendar part, newest first", () => {
    const { store, accountId, add } = setup();
    const a = add(1, att("invite.ics"));
    const b = add(2, att("notes.txt", "application/octet-stream").map((x) => ({ ...x, filename: "meeting.ICS" })));
    add(3, att("report.pdf", "application/pdf"));
    const c = add(4, att("invite.ics"));
    expect(store.uncheckedInviteMessages(10).map((m) => m.messageId).sort()).toEqual([a, b, c].sort());
    expect(store.uncheckedInviteMessages(2)).toHaveLength(2);
    store.markInviteChecked([a]);
    store.saveInvite({ messageId: b, accountId, invite: parsed("brand-review-v0.ics"), ics: "", parserVersion: 1, parsedAt: 1 });
    expect(store.uncheckedInviteMessages(10).map((m) => m.messageId)).toEqual([c]);
  });

  it("finds calendar attachments of a message", () => {
    const { store, add } = setup();
    const id = add(1, att("invite.ics"));
    expect(store.calendarAttachments(id)).toEqual([expect.objectContaining({ part: "2", filename: "invite.ics", contentType: "text/calendar" })]);
  });

  it("returns every version of an event, newest SEQUENCE first", () => {
    const { store, accountId, add } = setup();
    const m0 = add(1, att("a.ics"));
    const m1 = add(2, att("a.ics"));
    const other = add(3, att("a.ics"));
    const v0 = parsed("brand-review-v0.ics");
    const v1 = parsed("brand-review-v1.ics");
    store.saveInvite({ messageId: m0, accountId, invite: v0, ics: "", parserVersion: 1, parsedAt: 1 });
    store.saveInvite({ messageId: m1, accountId, invite: v1, ics: "", parserVersion: 1, parsedAt: 1 });
    store.saveInvite({ messageId: other, accountId, invite: parsed("google-weekly-meet.ics"), ics: "", parserVersion: 1, parsedAt: 1 });
    expect(store.invitesForEvent(accountId, v0.uid, "").map((v) => v.messageId)).toEqual([m1, m0]);
    expect(store.invitesForEvent(accountId, v0.uid, "20261103T230000Z")).toEqual([]);
  });

  it("stores one response per event and replaces it", () => {
    const { store, accountId } = setup();
    expect(store.getResponse(accountId, "u1", "")).toBeNull();
    store.setResponse({ accountId, uid: "u1", recurrenceId: "", response: "accepted", note: null, via: "imip", sequence: 0, respondedAt: 10 });
    store.setResponse({ accountId, uid: "u1", recurrenceId: "", response: "declined", note: "Out sick", via: "google-calendar", sequence: 1, respondedAt: 20 });
    store.setResponse({ accountId, uid: "u1", recurrenceId: "20261103T230000Z", response: "tentative", note: null, via: "imip", sequence: 1, respondedAt: 30 });
    expect(store.getResponse(accountId, "u1", "")).toEqual({ accountId, uid: "u1", recurrenceId: "", response: "declined", note: "Out sick", via: "google-calendar", sequence: 1, respondedAt: 20 });
    expect(store.getResponse(accountId, "u1", "20261103T230000Z")?.response).toBe("tentative");
  });

  it("drops invites and responses with their account", () => {
    const { store, accountId, add } = setup();
    const id = add(1, att("a.ics"));
    store.saveInvite({ messageId: id, accountId, invite: parsed("brand-review-v0.ics"), ics: "", parserVersion: 1, parsedAt: 1 });
    store.setResponse({ accountId, uid: "u1", recurrenceId: "", response: "accepted", note: null, via: "imip", sequence: 0, respondedAt: 10 });
    store.deleteAccount(accountId);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM invites").get()).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM invite_responses").get()).toEqual({ n: 0 });
  });

  it("keeps a bounded series upcoming until its last occurrence has ended", () => {
    const { store, accountId, add } = setup();
    const id = add(1, att("a.ics"));
    const base = parsed("google-weekly-meet.ics");
    const first = NOW - 21 * 86_400_000;
    const invite = { ...base, start: first, end: first + 3_600_000, timeZone: "UTC", recurrence: { summary: "Weekly", rrule: "FREQ=WEEKLY;COUNT=10", hasExceptions: false } };
    store.saveInvite({ messageId: id, accountId, invite, ics: "", parserVersion: INVITE_PARSER_VERSION, parsedAt: NOW });
    expect(store.upcomingInvites({ from: NOW, to: null, limit: 10 }).map((i) => i.messageId)).toEqual([id]);
    const over = NOW + 80 * 86_400_000;
    expect(store.upcomingInvites({ from: over, to: null, limit: 10 })).toEqual([]);
  });
});
