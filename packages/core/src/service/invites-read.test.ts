import { describe, expect, it, vi } from "vitest";
import { fixture, NOW } from "../calendar/fixtures";
import { createCodeRegistry } from "../codes/registry";
import type { Store } from "../store";
import { DEFAULT_SETTINGS } from "../store";
import { makeStore, msg, person, seedImap } from "../store/testkit";
import type { FlintEvent } from "../types";
import type { ServiceContext } from "./context";
import { backfillInvites, chipsForThreads, getInvite, listInvites } from "./invites-read";
import { readingApi } from "./reading";

const DAY = 86_400_000;
const att = (name = "invite.ics", size = 1500) => [{ part: "2", filename: name, contentType: "text/calendar", size, contentId: null, inline: false }];

type Rig = { ctx: ServiceContext; store: Store; fetches: number[]; events: FlintEvent[]; files: Map<string, string>; failing: Set<string>; setNow(n: number): void };

function rig(opts: { now?: number; scope?: boolean } = {}): Rig & { accountId: string; folderId: number } {
  const store = makeStore();
  const seed = seedImap(store);
  const account = opts.scope ? store.updateAccount(seed.account.id, { calendarScope: true }) : seed.account;
  let now = opts.now ?? NOW;
  const files = new Map<string, string>();
  const failing = new Set<string>();
  const fetches: number[] = [];
  const events: FlintEvent[] = [];
  const ctx = {
    store, now: () => now, emit: (e: FlintEvent) => events.push(e), caller: () => undefined, getSettings: () => DEFAULT_SETTINGS,
    codes: createCodeRegistry(() => now), ensureBodies: async () => undefined,
    syncs: {
      get: () => ({
        fetchAttachment: async (id: number) => {
          fetches.push(id);
          const a = store.getAttachment(id)!;
          if (failing.has(String(a.messageRowId))) throw new Error("offline");
          return Buffer.from(files.get(String(a.messageRowId)) ?? "", "utf8");
        },
      }),
    },
  } as unknown as ServiceContext;
  return { ctx, store, fetches, events, files, failing, accountId: account.id, folderId: seed.inbox.id, setNow: (n) => { now = n; } };
}

let uidCounter = 100;
function addInvite(r: ReturnType<typeof rig>, ics: string | null, over: { subject?: string; date?: number; attachments?: ReturnType<typeof att> } = {}): { messageId: number; threadId: number } {
  uidCounter += 1;
  const [o] = r.store.ingestMessages(r.accountId, r.folderId, [msg({
    uid: uidCounter, subject: over.subject ?? "Invitation", from: [person("Carla", "carla@northwind.example")], hasAttachments: true,
    date: over.date ?? NOW - DAY, attachments: over.attachments ?? att(),
  })]);
  if (ics !== null) r.files.set(String(o!.messageRowId), ics);
  return { messageId: o!.messageRowId, threadId: o!.threadId };
}

describe("getInvite: lazy parse", () => {
  it("downloads the calendar part once, stores it, and merges", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("google-weekly-meet.ics"), { subject: "Invitation: Design sync" });
    const invite = await getInvite(r.ctx, messageId);
    expect(invite).toMatchObject({ title: "Design sync", state: "new", yourResponse: "needs-action", rsvpVia: "imip", newerMessageId: null, changes: [] });
    expect(r.store.getStoredInvite(messageId)?.invite.uid).toBe("6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com");
    await getInvite(r.ctx, messageId);
    expect(r.fetches).toHaveLength(1);
  });

  it("returns null for an .ics that holds no event and does not download it again", async () => {
    const r = rig();
    const { messageId } = addInvite(r, "this is not a calendar", { attachments: att("notes.ics") });
    expect(await getInvite(r.ctx, messageId)).toBeNull();
    expect(await getInvite(r.ctx, messageId)).toBeNull();
    expect(r.fetches).toHaveLength(1);
  });

  it("returns null without downloading for a message with no calendar part", async () => {
    const r = rig();
    const [o] = r.store.ingestMessages(r.accountId, r.folderId, [msg({ uid: 9, attachments: [{ part: "2", filename: "a.pdf", contentType: "application/pdf", size: 5, contentId: null, inline: false }] })]);
    expect(await getInvite(r.ctx, o!.messageRowId)).toBeNull();
    expect(r.fetches).toHaveLength(0);
  });

  it("leaves a message unscanned when the download fails, then succeeds later", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("google-weekly-meet.ics"));
    r.failing.add(String(messageId));
    expect(await getInvite(r.ctx, messageId)).toBeNull();
    expect(r.store.isInviteChecked(messageId)).toBe(false);
    r.failing.clear();
    expect((await getInvite(r.ctx, messageId))?.title).toBe("Design sync");
  });

  it("fails with not_found for a message that does not exist", async () => {
    const r = rig();
    await expect(getInvite(r.ctx, 9999)).rejects.toMatchObject({ code: "not_found" });
  });

  it("re-parses a stored invite written by an older parser", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("brand-review-v0.ics"));
    await getInvite(r.ctx, messageId);
    r.store.db.prepare("UPDATE invites SET parser_version = 0, data_json = json_set(data_json, '$.title', 'stale') WHERE message_id = ?").run(messageId);
    expect((await getInvite(r.ctx, messageId))?.title).toBe("Brand review");
    expect(r.store.getStoredInvite(messageId)?.parserVersion).toBeGreaterThan(0);
  });
});

describe("states across versions of one event", () => {
  async function threeMessages(r: ReturnType<typeof rig>) {
    const v0 = addInvite(r, fixture("brand-review-v0.ics"), { date: NOW - 3 * DAY });
    const v1 = addInvite(r, fixture("brand-review-v1.ics"), { date: NOW - 2 * DAY });
    await getInvite(r.ctx, v0.messageId);
    await getInvite(r.ctx, v1.messageId);
    return { v0, v1 };
  }

  it("marks the newer one updated with what changed, and the older one superseded", async () => {
    const r = rig();
    const { v0, v1 } = await threeMessages(r);
    const updated = (await getInvite(r.ctx, v1.messageId))!;
    expect(updated.state).toBe("updated");
    expect(updated.changes.map((c) => c.field)).toEqual(["time", "location", "guests"]);
    expect(updated.changes[0]).toEqual({ field: "time", before: expect.stringContaining("Thu, Oct 29"), after: expect.stringContaining("Fri, Oct 30") });
    expect(updated.changes[1]).toEqual({ field: "location", before: "Studio 2", after: "Studio 5" });
    expect(updated.changes[2]).toEqual({ field: "guests", before: "3 guests", after: "4 guests, added Ines Duarte" });
    const old = (await getInvite(r.ctx, v0.messageId))!;
    expect(old).toMatchObject({ state: "superseded", newerMessageId: v1.messageId, rsvpVia: "none" });
  });

  it("marks every version cancelled once the CANCEL arrives", async () => {
    const r = rig();
    const { v0, v1 } = await threeMessages(r);
    const cancel = addInvite(r, fixture("brand-review-cancel.ics"), { date: NOW - DAY });
    expect((await getInvite(r.ctx, cancel.messageId))).toMatchObject({ state: "cancelled", rsvpVia: "none" });
    expect((await getInvite(r.ctx, v1.messageId))?.state).toBe("cancelled");
    expect((await getInvite(r.ctx, v0.messageId))?.state).toBe("cancelled");
  });

  it("treats a re-sent copy with the same SEQUENCE and DTSTAMP as the same version", async () => {
    const r = rig();
    const a = addInvite(r, fixture("brand-review-v1.ics"));
    const b = addInvite(r, fixture("brand-review-v1.ics"));
    expect((await getInvite(r.ctx, a.messageId))?.state).toBe("new");
    expect((await getInvite(r.ctx, b.messageId))?.state).toBe("new");
  });

  it("ignores versions in the trash", async () => {
    const r = rig();
    const { v0, v1 } = await threeMessages(r);
    const trash = r.store.upsertFolder(r.accountId, { path: "Trash", role: "trash" });
    r.store.db.prepare("INSERT INTO message_folders (message_id, folder_id) VALUES (?, ?)").run(v1.messageId, trash.id);
    expect((await getInvite(r.ctx, v0.messageId))?.state).toBe("new");
  });
});

describe("your response", () => {
  it("shows the recorded answer, with the note", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("google-weekly-meet.ics"));
    const stored = (await getInvite(r.ctx, messageId))!;
    r.store.setResponse({ accountId: r.accountId, uid: stored.uid, recurrenceId: "", response: "tentative", note: "Maybe late", via: "imip", sequence: 0, respondedAt: NOW });
    expect(await getInvite(r.ctx, messageId)).toMatchObject({ yourResponse: "tentative", respondedAt: NOW, yourNote: "Maybe late" });
  });

  it("prefers a later invite version that already carries your answer", async () => {
    const r = rig();
    const later = fixture("brand-review-v1.ics").replace("PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=me@example.com", "PARTSTAT=DECLINED;RSVP=TRUE;CN=me@example.com");
    const { messageId } = addInvite(r, later);
    r.store.setResponse({ accountId: r.accountId, uid: "brandreview001xq9@google.com", recurrenceId: "", response: "accepted", note: null, via: "imip", sequence: 0, respondedAt: Date.UTC(2026, 9, 22) });
    expect(await getInvite(r.ctx, messageId)).toMatchObject({ yourResponse: "declined", respondedAt: null });
  });

  it("applies a whole-series answer to a single-occurrence update", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("google-instance-update.ics"));
    r.store.setResponse({ accountId: r.accountId, uid: "6mk3qd8c1p2v9rj4tb0h5s7xyz@google.com", recurrenceId: "", response: "accepted", note: null, via: "imip", sequence: 0, respondedAt: NOW });
    expect((await getInvite(r.ctx, messageId))?.yourResponse).toBe("accepted");
  });
});

describe("rsvpVia", () => {
  it("is imip for IMAP accounts, none for the organizer and for guests-not-invited", async () => {
    const r = rig();
    const mine = addInvite(r, fixture("google-weekly-meet.ics"));
    const sent = addInvite(r, fixture("google-weekly-meet.ics").replace(/mailto:carla@northwind.example\r\nUID/, "mailto:me@example.com\r\nUID").replace("UID:6mk3", "UID:ownevent6mk3"));
    const notInvited = addInvite(r, fixture("publish-webinar.ics"));
    expect((await getInvite(r.ctx, mine.messageId))?.rsvpVia).toBe("imip");
    expect((await getInvite(r.ctx, sent.messageId))?.rsvpVia).toBe("none");
    expect((await getInvite(r.ctx, notInvited.messageId))?.rsvpVia).toBe("none");
  });

  it("follows the Google sign-in and its calendar scope", async () => {
    for (const [scope, expected] of [[false, "google-needs-scope"], [true, "google-calendar"]] as const) {
      const r = rig({ scope });
      r.store.updateAccount(r.accountId, { provider: "gmail", authKind: "oauth_google" });
      const { messageId } = addInvite(r, fixture("google-weekly-meet.ics"));
      expect((await getInvite(r.ctx, messageId))?.rsvpVia).toBe(expected);
    }
  });
});

describe("past events and series", () => {
  it("is past once the event ended", async () => {
    const r = rig({ now: Date.UTC(2026, 10, 1) });
    const { messageId } = addInvite(r, fixture("brand-review-v0.ics"));
    expect(await getInvite(r.ctx, messageId)).toMatchObject({ state: "past", rsvpVia: "none" });
  });

  it("shows the next occurrence of a running series, then past after UNTIL", async () => {
    const r = rig({ now: Date.UTC(2026, 10, 20, 12) });
    const { messageId } = addInvite(r, fixture("google-weekly-meet.ics"));
    const inv = (await getInvite(r.ctx, messageId))!;
    expect(inv.state).toBe("new");
    expect(inv.start).toBe(Date.UTC(2026, 10, 24, 23)); // Tue Nov 24, 3 PM PST
    expect(inv.end - inv.start).toBe(3_600_000);
    r.setNow(Date.UTC(2026, 11, 20));
    expect((await getInvite(r.ctx, messageId))?.state).toBe("past");
  });

  it("keeps an in-progress occurrence", async () => {
    const r = rig({ now: Date.UTC(2026, 10, 10, 23, 30) });
    const { messageId } = addInvite(r, fixture("google-weekly-meet.ics"));
    expect((await getInvite(r.ctx, messageId))?.start).toBe(Date.UTC(2026, 10, 10, 23));
  });
});

describe("replies and other methods", () => {
  it("shows a REPLY as a reply", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("google-reply.ics"));
    expect(await getInvite(r.ctx, messageId)).toMatchObject({ state: "reply", rsvpVia: "none", reply: { response: "accepted" } });
  });
  it("shows COUNTER plainly", async () => {
    const r = rig();
    const { messageId } = addInvite(r, fixture("brand-review-v1.ics").replace("METHOD:REQUEST", "METHOD:COUNTER"));
    expect(await getInvite(r.ctx, messageId)).toMatchObject({ state: "counter", rsvpVia: "none" });
  });
  it("does not let a REPLY or COUNTER hide the request it answers", async () => {
    const r = rig();
    const req = addInvite(r, fixture("brand-review-v1.ics"));
    addInvite(r, fixture("brand-review-v1.ics").replace("METHOD:REQUEST", "METHOD:COUNTER").replace("SEQUENCE:2", "SEQUENCE:9"));
    expect((await getInvite(r.ctx, req.messageId))?.state).toBe("new");
  });
});

describe("thread chips and the upcoming list", () => {
  it("picks the most relevant invitation per thread", async () => {
    const r = rig();
    const a = addInvite(r, fixture("brand-review-v1.ics"), { subject: "Brand review" });
    const b = addInvite(r, fixture("google-reply.ics"), { subject: "Accepted: Project kickoff" });
    const c = addInvite(r, fixture("brand-review-cancel.ics").replace("brandreview001xq9", "other"), { subject: "Cancelled" });
    const none = addInvite(r, null, { subject: "Other", attachments: [] });
    for (const m of [a, b, c]) await getInvite(r.ctx, m.messageId);
    const chips = chipsForThreads(r.ctx, [a.threadId, b.threadId, c.threadId, none.threadId]);
    expect(chips.get(a.threadId)).toMatchObject({ title: "Brand review", state: "new", organizerName: "Mina Okafor", messageId: a.messageId, start: Date.UTC(2026, 9, 30, 19) });
    expect(chips.get(b.threadId)).toMatchObject({ state: "reply", organizerName: "Carla Ortiz" });
    expect(chips.get(c.threadId)?.state).toBe("cancelled");
    expect(chips.has(none.threadId)).toBe(false);
  });

  it("lists coming invitations soonest first, newest version only, without cancelled or past", async () => {
    const r = rig();
    const v0 = addInvite(r, fixture("brand-review-v0.ics"), { date: NOW - 3 * DAY, subject: "Brand review" });
    const v1 = addInvite(r, fixture("brand-review-v1.ics"), { date: NOW - 2 * DAY, subject: "Updated: Brand review" });
    const weekly = addInvite(r, fixture("google-weekly-meet.ics"), { subject: "Design sync" });
    const zoom = addInvite(r, fixture("outlook-zoom.ics"), { subject: "Contoso vendor intro" });
    const cancelled = addInvite(r, fixture("brand-review-cancel.ics").replace("brandreview001xq9", "gone"), { subject: "Gone" });
    const done = addInvite(r, fixture("brand-review-v0.ics").replace("brandreview001xq9", "done").replaceAll("20261029", "20261001"), { subject: "Done" });
    for (const m of [v0, v1, weekly, zoom, cancelled, done]) await getInvite(r.ctx, m.messageId);
    const list = await listInvites(r.ctx);
    expect(list.map((i) => i.subject)).toEqual(["Design sync", "Contoso vendor intro", "Updated: Brand review"]);
    expect(list[0]).toMatchObject({ threadId: weekly.threadId, accountId: r.accountId, invite: { state: "new", messageId: weekly.messageId } });
    expect((await listInvites(r.ctx, { limit: 1 })).map((i) => i.subject)).toEqual(["Design sync"]);
    expect((await listInvites(r.ctx, { to: Date.UTC(2026, 9, 28) })).map((i) => i.subject)).toEqual(["Design sync"]);
    expect(await listInvites(r.ctx, { accountId: "nobody" })).toEqual([]);
  });
});

describe("backfill and the reading API", () => {
  it("parses older mail that was never looked at and reports the threads", async () => {
    const r = rig();
    const a = addInvite(r, fixture("brand-review-v1.ics"));
    const b = addInvite(r, "garbage");
    expect(await backfillInvites(r.ctx)).toBe(1);
    expect(r.store.getStoredInvite(a.messageId)).not.toBeNull();
    expect(r.store.isInviteChecked(b.messageId)).toBe(true);
    expect(r.events).toContainEqual({ type: "mail_changed", accountId: r.accountId, threadIds: [a.threadId] });
    expect(await backfillInvites(r.ctx)).toBe(0);
  });

  it("does not let unreachable messages starve older ones, and retries them later", async () => {
    const r = rig();
    const bad = addInvite(r, fixture("brand-review-v1.ics"), { date: NOW - DAY });
    r.failing.add(String(bad.messageId));
    const good = addInvite(r, fixture("google-weekly-meet.ics"), { date: NOW - 2 * DAY });
    expect(await backfillInvites(r.ctx, 1)).toBe(0); // takes the newest (unreachable) one
    expect(await backfillInvites(r.ctx, 1)).toBe(1); // skips it and reaches the older one
    expect(r.store.getStoredInvite(good.messageId)).not.toBeNull();
    r.failing.clear();
    expect(await backfillInvites(r.ctx, 1)).toBe(0); // still resting
    r.setNow(NOW + 7 * 3_600_000);
    expect(await backfillInvites(r.ctx, 1)).toBe(1);
    expect(r.store.getStoredInvite(bad.messageId)).not.toBeNull();
  });

  it("getThread, getMessage and listThreads carry the invite and chip", async () => {
    const r = rig();
    const a = addInvite(r, fixture("google-weekly-meet.ics"), { subject: "Invitation: Design sync" });
    const api = readingApi(r.ctx);
    const thread = await api.getThread(a.threadId);
    expect(thread.messages[0]?.invite).toMatchObject({ title: "Design sync", state: "new" });
    expect((await api.getMessage(a.messageId)).invite?.title).toBe("Design sync");
    const page = await api.listThreads({ view: "inbox", focused: false });
    expect(page.items.find((t) => t.id === a.threadId)?.invite).toMatchObject({ title: "Design sync", messageId: a.messageId });
  });

  it("waits only briefly for a slow download and tells the UI when it lands", async () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      const a = addInvite(r, fixture("google-weekly-meet.ics"));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const original = (r.ctx.syncs.get("x") as { fetchAttachment: (id: number) => Promise<Buffer> }).fetchAttachment;
      (r.ctx as unknown as { syncs: unknown }).syncs = { get: () => ({ fetchAttachment: async (id: number) => { await gate; return original(id); } }) };
      const pending = readingApi(r.ctx).getThread(a.threadId);
      await vi.advanceTimersByTimeAsync(2_000);
      const thread = await pending;
      expect(thread.messages[0]?.invite).toBeUndefined();
      release();
      await vi.advanceTimersByTimeAsync(10);
      expect(r.events).toContainEqual({ type: "mail_changed", accountId: r.accountId, threadIds: [a.threadId] });
      expect((await readingApi(r.ctx).getThread(a.threadId)).messages[0]?.invite?.title).toBe("Design sync");
    } finally {
      vi.useRealTimers();
    }
  });
});
