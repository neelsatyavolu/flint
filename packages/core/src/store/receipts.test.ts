import { describe, expect, it } from "vitest";
import { FlintError } from "../types";
import { isPossiblyForwarded, recipientStatus, summarize } from "./receiptStatus";
import { DAY, makeStore, me, msg, person, seedImap, T0 } from "./testkit";

const HOUR = 3_600_000;

describe("receipt status rules", () => {
  it("replied > opened > unknowable > sent, untracked when unregistered", () => {
    expect(recipientStatus({ openCount: 3, repliedAt: 5, sawPrefetch: true, registered: true })).toBe("replied");
    expect(recipientStatus({ openCount: 1, repliedAt: null, sawPrefetch: true, registered: true })).toBe("opened");
    expect(recipientStatus({ openCount: 0, repliedAt: null, sawPrefetch: true, registered: true })).toBe("unknowable");
    expect(recipientStatus({ openCount: 0, repliedAt: null, sawPrefetch: false, registered: true })).toBe("sent");
    expect(recipientStatus({ openCount: 0, repliedAt: null, sawPrefetch: false, registered: false })).toBe("untracked");
    expect(recipientStatus({ openCount: 0, repliedAt: 9, sawPrefetch: false, registered: false })).toBe("replied");
  });

  it("flags possible forwards only when fingerprint and client differ more than an hour later", () => {
    const first = { at: 0, fingerprint: "a", client: "Gmail" };
    expect(isPossiblyForwarded([first])).toBe(false);
    expect(isPossiblyForwarded([first, { at: HOUR + 1, fingerprint: "b", client: "Outlook" }])).toBe(true);
    expect(isPossiblyForwarded([first, { at: HOUR - 1, fingerprint: "b", client: "Outlook" }])).toBe(false);
    expect(isPossiblyForwarded([first, { at: 2 * HOUR, fingerprint: "a", client: "Outlook" }])).toBe(false);
    expect(isPossiblyForwarded([first, { at: 2 * HOUR, fingerprint: "b", client: "Gmail" }])).toBe(false);
  });

  it("summarizes recipients", () => {
    const r = (status: Parameters<typeof summarize>[0][number]["status"], lastOpenAt: number | null = null) => ({ status, lastOpenAt });
    expect(summarize([r("sent"), r("opened", 5), r("replied", 9)])).toEqual({ opened: 2, total: 3, status: "replied", lastOpenAt: 9 });
    expect(summarize([r("sent"), r("opened", 5)]).status).toBe("opened");
    expect(summarize([r("unknowable"), r("sent")]).status).toBe("sent");
    expect(summarize([r("unknowable"), r("untracked")]).status).toBe("unknowable");
    expect(summarize([r("untracked")]).status).toBe("untracked");
    expect(summarize([])).toEqual({ opened: 0, total: 0, status: "sent", lastOpenAt: null });
  });
});

describe("tracked messages", () => {
  function setup() {
    const store = makeStore();
    const s = seedImap(store);
    const [sent] = store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, messageId: "s@x", from: [me()], to: [person("Carla"), person("Dan")], date: T0, headers: { "x-flint-ref": "ref1" }, flags: { seen: true, flagged: false, answered: false, draft: false } })]);
    const trackedId = store.createTracked({
      accountId: s.account.id, ref: "ref1", messageId: "s@x", threadId: null, subject: "Proposal", sentAt: T0,
      recipients: [{ email: "Carla@example.org", name: "Carla", token: "tc" }, { email: "dan@example.org", name: "Dan", token: "td" }],
    });
    return { store, s, sent: sent!, trackedId };
  }

  it("links a synced sent message by ref or Message-ID", () => {
    const store = makeStore();
    const s = seedImap(store);
    const trackedId = store.createTracked({ accountId: s.account.id, ref: "ref9", messageId: "q@x", threadId: null, subject: "S", sentAt: T0, recipients: [{ email: "a@x.com", token: "t9" }] });
    expect(store.findTrackedByRef("ref9")).toBe(trackedId);
    expect(store.findTrackedByMessageId(s.account.id, "q@x")).toBe(trackedId);
    const [o] = store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, messageId: "q@x", from: [me()], to: [person("A", "a@x.com")] })]);
    expect(store.getTracked(trackedId)!.threadId).toBe(o!.threadId);
  });

  it("derives status from events: opened, prefetch only, scanners ignored", () => {
    const { store, trackedId } = setup();
    const changes = store.ingestReceiptEvents([
      { remoteId: "1", token: "tc", at: T0 + 1000, kind: "scanner" },
      { remoteId: "2", token: "tc", at: T0 + 2000, kind: "open", client: "Gmail", device: "web", location: "Oslo, NO", fingerprint: "f1" },
      { remoteId: "3", token: "td", at: T0 + 3000, kind: "prefetch", client: "Apple Mail" },
      { remoteId: "x", token: "unknown", at: T0, kind: "open" },
    ]);
    expect(changes.map((c) => [c.email, c.status]).sort()).toEqual([["carla@example.org", "opened"], ["dan@example.org", "unknowable"]]);
    const detail = store.getReceiptDetail(trackedId);
    const carla = detail.recipients.find((r) => r.email === "carla@example.org")!;
    const dan = detail.recipients.find((r) => r.email === "dan@example.org")!;
    expect(carla).toMatchObject({ status: "opened", openCount: 1, firstOpenAt: T0 + 2000, lastOpenAt: T0 + 2000, name: "Carla", possiblyForwarded: false });
    expect(dan).toMatchObject({ status: "unknowable", openCount: 0 });
    expect(dan.note).toMatch(/Apple Mail Privacy Protection/);
    expect(detail.events.map((e) => [e.kind, e.counted])).toEqual([["prefetch", false], ["open", true], ["scanner", false]]);
    // duplicates are ignored and report nothing
    expect(store.ingestReceiptEvents([{ remoteId: "2", token: "tc", at: T0 + 2000, kind: "open" }])).toEqual([]);
    // a later real open upgrades the prefetch-only recipient
    const up = store.ingestReceiptEvents([{ remoteId: "4", token: "td", at: T0 + 5000, kind: "open", client: "Outlook", fingerprint: "f9" }]);
    expect(up).toEqual([{ trackedId, email: "dan@example.org", status: "opened", at: T0 + 5000 }]);
    expect(store.getReceiptDetail(trackedId).recipients.find((r) => r.email === "dan@example.org")!.note).toBeNull();
  });

  it("flags a possible forward in the recipient view", () => {
    const { store, trackedId } = setup();
    store.ingestReceiptEvents([
      { remoteId: "1", token: "tc", at: T0 + 1000, kind: "open", client: "Gmail", fingerprint: "f1" },
      { remoteId: "2", token: "tc", at: T0 + 3 * HOUR, kind: "open", client: "Outlook", fingerprint: "f2" },
    ]);
    const carla = store.getTracked(trackedId)!.recipients.find((r) => r.email === "carla@example.org")!;
    expect(carla).toMatchObject({ status: "opened", openCount: 2, possiblyForwarded: true });
  });

  it("marks a recipient replied when their message arrives in the thread, and reports it from ingest", () => {
    const { store, s, sent, trackedId } = setup();
    store.linkSentMessage(s.account.id, "ref1", "s@x", sent.threadId);
    const [reply] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 5, messageId: "re@x", references: ["s@x"], from: [person("Carla")], date: T0 + DAY })]);
    expect(reply!.receiptChanges).toEqual([{ trackedId, email: "carla@example.org", status: "replied", at: T0 + DAY }]);
    const detail = store.getReceiptDetail(trackedId);
    expect(detail.recipients.find((r) => r.email === "carla@example.org")).toMatchObject({ status: "replied", repliedAt: T0 + DAY });
    expect(detail.recipients.find((r) => r.email === "dan@example.org")!.status).toBe("sent");
    // a reply from the sender's own address never counts
    expect(store.recomputeForThread(sent.threadId)).toEqual([]);
  });

  it("lists tracked messages with filters, unregistered handling and stop", () => {
    const { store, s, trackedId } = setup();
    const other = store.createTracked({ accountId: s.account.id, ref: "ref2", messageId: "o@x", threadId: null, subject: "Second", sentAt: T0 + DAY, recipients: [{ email: "eve@x.com", token: "te" }], state: "unregistered" });
    expect(store.listTracked().map((t) => t.trackedId)).toEqual([other, trackedId]);
    expect(store.getTracked(other)!.recipients[0]!.status).toBe("untracked");
    store.ingestReceiptEvents([{ remoteId: "1", token: "tc", at: T0 + 10, kind: "open" }]);
    expect(store.listTracked({ status: "opened" }).map((t) => t.trackedId)).toEqual([trackedId]);
    expect(store.listTracked({ status: "unopened" }).map((t) => t.trackedId)).toEqual([other]);
    expect(store.listPollable(T0).map((p) => p.trackedId)).toEqual([trackedId]);
    store.setTrackedState(trackedId, "stopped");
    expect(store.listPollable(T0)).toEqual([]);
    expect(store.getReceiptDetailForMessage(s.account.id, "o@x")?.trackedId).toBe(other);
    expect(store.getReceiptDetailForMessage(s.account.id, "none")).toBeNull();
    expect(() => store.getReceiptDetail(9999)).toThrowError(FlintError);
    expect(store.listTracked({ limit: 1 })).toHaveLength(1);
  });
});
