// End to end at the store level: an invite email is ingested, read through the service, answered through a fake Google
// Calendar API and through iMIP (the sent message is captured), and the local response shows on the message view.
import { describe, expect, it, vi } from "vitest";
import type { GoogleCalendarClient, GoogleRespondInput } from "../calendar/contracts";
import { fixture, NOW } from "../calendar/fixtures";
import { createCodeRegistry } from "../codes/registry";
import { DEFAULT_SETTINGS } from "../store";
import { makeStore, msg, person, seedImap } from "../store/testkit";
import type { FlintEvent } from "../types";
import type { ServiceContext } from "./context";
import { invitesApi } from "./invites";
import { readingApi } from "./reading";

vi.mock("../mail/connect", () => ({ resolveAuth: async () => ({ user: "me@example.com", accessToken: "tok" }) }));

const DAY = 86_400_000;

function rig(opts: { google?: boolean } = {}) {
  const store = makeStore();
  const seed = seedImap(store);
  const account = opts.google ? store.updateAccount(seed.account.id, { provider: "gmail", authKind: "oauth_google", calendarScope: true }) : seed.account;
  const [o] = store.ingestMessages(account.id, seed.inbox.id, [msg({
    uid: 5, subject: "Invitation: Design sync", from: [person("Carla Ortiz", "carla@northwind.example")], hasAttachments: true, date: NOW - DAY,
    attachments: [{ part: "2", filename: "invite.ics", contentType: "text/calendar", size: 1500, contentId: null, inline: false }],
  })]);
  const events: FlintEvent[] = [];
  const sent: { from: { address: string }; to: { address: string }; subject: string; ics: string; html: string }[] = [];
  const respond = vi.fn(async (_i: GoogleRespondInput) => ({ eventId: "e1", htmlLink: null }));
  const google = { respond, listEvents: async () => [{ title: "Standup", start: NOW + 2 * DAY, end: NOW + 2 * DAY + 1, allDay: false, id: "x" }] } as unknown as GoogleCalendarClient;
  const ctx = {
    store, now: () => NOW, emit: (e: FlintEvent) => events.push(e), caller: () => undefined, getSettings: () => DEFAULT_SETTINGS,
    codes: createCodeRegistry(() => NOW), ensureBodies: async () => undefined, platform: { secrets: {} }, googleClient: () => null, fetch: vi.fn(),
    syncs: { get: () => ({ fetchAttachment: async () => Buffer.from(fixture("google-weekly-meet.ics"), "utf8") }) },
    invites: { google, sendImip: async (_a: unknown, reply: (typeof sent)[number]) => void sent.push(reply) },
  } as unknown as ServiceContext;
  return { ctx, store, events, sent, respond, messageId: o!.messageRowId, threadId: o!.threadId, api: invitesApi(ctx), reading: readingApi(ctx) };
}

describe("invite end to end", () => {
  it("shows the parsed invite on the message view and the thread chip", async () => {
    const r = rig();
    const thread = await r.reading.getThread(r.threadId);
    const view = thread.messages.find((m) => m.id === r.messageId)!;
    expect(view.invite).toMatchObject({ title: "Design sync", state: "new", yourResponse: "needs-action", rsvpVia: "imip" });
    await r.api.getInvite(r.messageId);
    const page = await r.reading.listThreads({ view: "inbox" });
    expect(page.items.find((t) => t.id === r.threadId)?.invite).toMatchObject({ title: "Design sync", state: "new" });
  });

  it("answers by iMIP, captures the sent REPLY, and shows the response after a reload", async () => {
    const r = rig();
    const out = await r.api.rsvp(r.messageId, "accepted", "See you there");
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toMatchObject({ from: { address: "me@example.com" }, to: { address: "carla@northwind.example" }, subject: "Accepted: Design sync" });
    expect(r.sent[0]!.ics).toContain("METHOD:REPLY");
    expect(r.sent[0]!.ics).toContain("PARTSTAT=ACCEPTED");
    expect(r.sent[0]!.html).not.toMatch(/<img/i);
    expect(out.yourResponse).toBe("accepted");
    expect(r.events.some((e) => e.type === "mail_changed")).toBe(true);
    const again = await r.reading.getThread(r.threadId);
    expect(again.messages.find((m) => m.id === r.messageId)?.invite).toMatchObject({ yourResponse: "accepted", yourNote: "See you there" });
  });

  it("answers through the Google Calendar API when the account has the scope, sending no mail", async () => {
    const r = rig({ google: true });
    const before = await r.api.getInvite(r.messageId);
    expect(before?.rsvpVia).toBe("google-calendar");
    const out = await r.api.rsvp(r.messageId, "declined");
    expect(r.respond).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "tok", uid: "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com", response: "declined" }));
    expect(r.sent).toHaveLength(0);
    expect(out.yourResponse).toBe("declined");
  });

  it("reports conflicts for a Google account with the scope and unknown otherwise", async () => {
    const g = rig({ google: true });
    expect((await g.api.inviteConflicts(g.messageId)).status).toMatch(/conflict|free/);
    const p = rig();
    expect((await p.api.inviteConflicts(p.messageId)).status).toBe("unknown");
  });
});
