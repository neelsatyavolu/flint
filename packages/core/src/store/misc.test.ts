import { describe, expect, it } from "vitest";
import { FlintError } from "../types";
import { DEFAULT_SETTINGS, deepMerge } from "./settings";
import { DAY, makeStore, me, msg, person, seedImap, T0 } from "./testkit";

describe("settings", () => {
  it("returns defaults, then merges stored overrides", () => {
    const store = makeStore();
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    const next = store.updateSettings({ appearance: { theme: "dark" }, compose: { undoSendSeconds: 20, defaultSignatureByAccount: { a1: 3 } } });
    expect(next.appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, theme: "dark" });
    expect(next.compose.undoSendSeconds).toBe(20);
    store.updateSettings({ compose: { defaultSignatureByAccount: { a2: null } } });
    expect(store.getSettings().compose.defaultSignatureByAccount).toEqual({ a1: 3, a2: null });
    expect(store.getSettings().appearance.theme).toBe("dark");
    store.updateSettings({ ai: { provider: "codex", model: "gpt-x" }, agents: { send: "allow" } });
    expect(store.getSettings()).toMatchObject({ ai: { provider: "codex", model: "gpt-x" }, agents: { send: "allow", modify: "allow" } });
  });

  it("rejects invalid values and unknown keys without changing anything", () => {
    const store = makeStore();
    expect(() => store.updateSettings({ appearance: { theme: "neon" as never } })).toThrowError(FlintError);
    expect(() => store.updateSettings({ compose: { undoSendSeconds: 7 as never } })).toThrowError(/not valid/);
    expect(() => store.updateSettings({ nope: { a: 1 } } as never)).toThrowError(FlintError);
    expect(() => store.updateSettings({ sync: { initialDays: -1 } })).toThrowError(FlintError);
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when stored data is corrupt", () => {
    const store = makeStore();
    store.db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run('{"appearance":{"theme":"bogus"}}');
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
    store.db.prepare("UPDATE settings SET value = 'not json' WHERE key = 'app'").run();
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("deepMerge is immutable", () => {
    const base = { a: { b: 1, c: [1] }, d: 2 };
    const out = deepMerge(base, { a: { b: 5, c: [2, 3] } });
    expect(out).toEqual({ a: { b: 5, c: [2, 3] }, d: 2 });
    expect(base).toEqual({ a: { b: 1, c: [1] }, d: 2 });
  });
});

describe("kv cache and agent activity", () => {
  it("honors TTLs", () => {
    const store = makeStore();
    store.kvSet("k", "v", 1000, 5000);
    store.kvSet("forever", "x", undefined, 5000);
    expect(store.kvGet("k", 5999)).toBe("v");
    expect(store.kvGet("k", 6000)).toBeNull();
    expect(store.kvGet("k", 5500)).toBeNull();
    expect(store.kvGet("forever", 9e12)).toBe("x");
    store.kvSet("a", "1", 10, 0);
    store.kvSet("a", "2", 10, 100);
    expect(store.kvGet("a", 105)).toBe("2");
    expect(store.kvPurgeExpired(1000)).toBe(1);
    store.kvDelete("forever");
    expect(store.kvGet("forever")).toBeNull();
    expect(store.kvGet("missing")).toBeNull();
  });

  it("records, lists, pages and updates activity", () => {
    const store = makeStore();
    const a = store.insertActivity({ agent: "cli", method: "listThreads", summary: "Listed inbox", status: "ok", at: 100 });
    const b = store.insertActivity({ agent: "claude", method: "sendDraft", summary: "Queued mail to cindy@x.com for approval", status: "awaiting_approval", detail: { draftId: 4 }, at: 200 });
    expect(store.listActivity().map((x) => x.id)).toEqual([b.id, a.id]);
    expect(store.listActivity({ before: 200 }).map((x) => x.id)).toEqual([a.id]);
    expect(store.listActivity({ limit: 1 })).toHaveLength(1);
    const u = store.updateActivity(b.id, { status: "approved", detail: { by: "user" } });
    expect(u).toMatchObject({ status: "approved", detail: { draftId: 4, by: "user" } });
    expect(store.getActivity(9999)).toBeNull();
    expect(() => store.updateActivity(9999, { status: "ok" })).toThrowError(FlintError);
  });
});

describe("drafts, scheduled sends, reminders, library", () => {
  it("round-trips drafts and their meta", () => {
    const store = makeStore();
    const s = seedImap(store);
    const d = store.createDraft({ accountId: s.account.id, from: "me@example.com", to: [person("Bo")], subject: "Hi", html: "<p>x</p>", inReplyTo: "p@x", references: ["a@x", "p@x"] }, 1000);
    expect(d).toMatchObject({ mode: "new", track: true, createdBy: "user", updatedAt: 1000, attachments: [], to: [person("Bo")] });
    expect(store.getDraftMeta(d.id)).toEqual({ inReplyTo: "p@x", references: ["a@x", "p@x"], serverUid: null, serverMessageId: null });
    store.setDraftMeta(d.id, { serverUid: 12 });
    expect(store.getDraftMeta(d.id).serverUid).toBe(12);
    const u = store.updateDraft(d.id, { subject: "Hello", cc: [person("Cy")], track: false, remindAt: 99, attachments: [{ id: "a", filename: "f", contentType: "text/plain", size: 1, path: "/f" }] }, 2000);
    expect(u).toMatchObject({ subject: "Hello", track: false, remindAt: 99, updatedAt: 2000, cc: [person("Cy")] });
    expect(u.attachments).toHaveLength(1);
    expect(store.listDrafts().map((x) => x.id)).toEqual([d.id]);
    store.deleteDraft(d.id);
    expect(store.getDraft(d.id)).toBeNull();
    expect(() => store.updateDraft(d.id, {})).toThrowError(FlintError);
    expect(() => store.getDraftMeta(d.id)).toThrowError(FlintError);
  });

  it("queues scheduled sends and lists due and open ones", () => {
    const store = makeStore();
    const s = seedImap(store);
    const d = store.createDraft({ accountId: s.account.id, from: "me@example.com", to: [person("Bo")], subject: "Later" });
    const a = store.createScheduledSend({ draftId: d.id, sendAt: 1000 }, 1);
    const b = store.createScheduledSend({ draftId: d.id, sendAt: 5000, status: "awaiting_approval", requestedBy: "agent:claude" }, 1);
    expect(a).toMatchObject({ subject: "Later", to: [person("Bo")], status: "pending", requestedBy: "user", attempts: 0 });
    expect(store.listDueScheduled(999)).toEqual([]);
    expect(store.listDueScheduled(1000).map((x) => x.id)).toEqual([a.id]);
    expect(store.nextScheduledAt()).toBe(1000);
    expect(store.listScheduled().map((x) => x.id)).toEqual([a.id, b.id]);
    expect(store.findOpenScheduledForDraft(d.id)?.id).toBe(b.id);
    expect(store.updateScheduled(a.id, { status: "failed", error: "SMTP down", attempts: 3 })).toMatchObject({ status: "failed", error: "SMTP down", attempts: 3 });
    expect(store.updateScheduled(a.id, { status: "sent", messageId: "m@x", error: null }).messageId).toBe("m@x");
    expect(store.listScheduled().map((x) => x.id)).toEqual([b.id]);
    expect(store.nextScheduledAt()).toBeNull();
    expect(() => store.updateScheduled(999, {})).toThrowError(FlintError);
    store.deleteDraft(d.id);
    expect(store.listScheduled()).toEqual([]);
  });

  it("reminders fire when no one else replied", () => {
    const store = makeStore();
    const s = seedImap(store);
    const [sent] = store.ingestMessages(s.account.id, s.sent.id, [msg({ uid: 1, messageId: "s@x", from: [me()], to: [person("Carla")], date: T0, flags: { seen: true, flagged: false, answered: false, draft: false } })]);
    const r = store.createReminder({ accountId: s.account.id, threadId: sent!.threadId, messageId: "<s@x>", remindAt: T0 + DAY });
    expect(r).toMatchObject({ messageId: "s@x", status: "pending" });
    expect(store.listDueReminders(T0)).toEqual([]);
    expect(store.listDueReminders(T0 + DAY).map((x) => x.id)).toEqual([r.id]);
    expect(store.nextReminderAt()).toBe(T0 + DAY);
    expect(store.threadHasReplySince(sent!.threadId, T0)).toBe(false);
    store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 2, messageId: "r@x", references: ["s@x"], from: [person("Carla")], date: T0 + 1000 })]);
    expect(store.threadHasReplySince(sent!.threadId, T0)).toBe(true);
    store.setReminderStatus(r.id, "fired");
    expect(store.listPendingReminders()).toEqual([]);
    const r2 = store.createReminder({ accountId: s.account.id, threadId: null, messageId: "z@x", remindAt: 5 });
    store.cancelRemindersForMessage(s.account.id, "<z@x>");
    expect(store.getReminder(r2.id)!.status).toBe("cancelled");
  });

  it("signatures keep one default per scope; templates round-trip", () => {
    const store = makeStore();
    const s = seedImap(store);
    const a = store.saveSignature({ name: "Work", html: "<p>W</p>", accountId: s.account.id, defaultNew: true, defaultReply: false });
    const b = store.saveSignature({ name: "Work 2", html: "<p>W2</p>", accountId: s.account.id, defaultNew: true, defaultReply: true });
    expect(store.listSignatures().map((x) => [x.name, x.defaultNew])).toEqual([["Work", false], ["Work 2", true]]);
    expect(store.saveSignature({ ...a, name: "Renamed" }).name).toBe("Renamed");
    expect(() => store.saveSignature({ name: "", html: "", accountId: null, defaultNew: false, defaultReply: false })).toThrowError(FlintError);
    expect(() => store.saveSignature({ ...a, id: 999 })).toThrowError(/no longer exists/);
    store.deleteSignature(b.id);
    expect(store.listSignatures()).toHaveLength(1);
    const t = store.saveTemplate({ name: "Intro", subject: "Hello", html: "<p>hi</p>" });
    expect(store.saveTemplate({ ...t, subject: "Hey" }).subject).toBe("Hey");
    expect(store.listTemplates()).toHaveLength(1);
    expect(() => store.saveTemplate({ name: "", subject: "", html: "" })).toThrowError(FlintError);
    expect(() => store.saveTemplate({ ...t, id: 999 })).toThrowError(FlintError);
    store.deleteTemplate(t.id);
    expect(store.listTemplates()).toEqual([]);
  });
});
