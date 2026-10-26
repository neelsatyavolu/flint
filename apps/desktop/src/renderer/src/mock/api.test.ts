import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlintEvent } from "@flint/core";
import { createMockApi } from "./api";

const NOW = new Date(2026, 9, 25, 16, 0).getTime();
const make = () => createMockApi({ now: NOW });
const collect = (api: ReturnType<typeof make>) => {
  const events: FlintEvent[] = [];
  api.subscribe((e) => events.push(e));
  return events;
};
const allViews = ["inbox", "archive", "trash", "spam", "sent", "drafts"] as const;

afterEach(() => vi.useRealTimers());

describe("fixtures", () => {
  it("has three accounts of the right providers", async () => {
    const api = make();
    const accounts = await api.listAccounts();
    expect(accounts.map((a) => [a.email, a.provider])).toEqual([["alex@northwind.dev", "gmail"], ["alex@studio-orbit.com", "imap"], ["alex.rivera@gmail.com", "gmail"]]);
  });

  it("has about 120 threads spread over three months", async () => {
    const api = make();
    const ids = new Set<number>();
    let oldest = NOW;
    for (const view of allViews) {
      const page = await api.listThreads({ view, limit: 200 });
      for (const i of page.items) {
        ids.add(i.id);
        oldest = Math.min(oldest, i.lastDate);
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(115);
    expect(ids.size).toBeLessThanOrEqual(135);
    expect((NOW - oldest) / 86_400_000).toBeGreaterThan(60);
  });

  it("is deterministic for the same clock and seed", async () => {
    const a = await make().listThreads({ view: "inbox", limit: 20 });
    const b = await make().listThreads({ view: "inbox", limit: 20 });
    expect(a.items.map((i) => i.subject)).toEqual(b.items.map((i) => i.subject));
  });

  it("has a long project thread with attachments and a forwarded mail", async () => {
    const api = make();
    const { items } = await api.listThreads({ view: "search", search: "Freelancing Cycle 3" });
    const detail = await api.getThread(items[0]!.id);
    expect(detail.messages.length).toBe(9);
    expect(detail.messages.some((m) => m.attachments.length > 0)).toBe(true);
    const fwd = await api.listThreads({ view: "search", search: "Invoice 2291" });
    const thread = await api.getThread(fwd.items[0]!.id);
    expect(thread.messages.some((m) => m.html?.includes("Forwarded message"))).toBe(true);
  });

  it("includes newsletters with list-unsubscribe, a text-only mail and rich html", async () => {
    const api = make();
    const news = await api.listThreads({ view: "inbox", category: "newsletters", limit: 50 });
    expect(news.items.length).toBeGreaterThan(5);
    const first = await api.getThread(news.items.find((i) => i.subject.startsWith("#212"))!.id);
    expect(first.messages[0]!.unsubscribe?.oneClick).toBe(true);
    expect(first.messages[0]!.remoteImages).toBe("blocked");
    expect(first.messages[0]!.html).toContain("<table");
    const text = await api.listThreads({ view: "search", search: "Weekend trip" });
    const msgs = (await api.getThread(text.items[0]!.id)).messages;
    expect(msgs[0]!.html).toBeNull();
    expect(msgs[0]!.text).toContain("coast");
  });

  it("returns focused inbox with bundles", async () => {
    const page = await make().listThreads({ view: "inbox", focused: true, limit: 200 });
    expect(page.items.every((i) => i.category === "people")).toBe(true);
    expect(page.bundles.map((b) => b.category).sort()).toEqual(["newsletters", "notifications"]);
    expect(page.bundles[0]!.latest.length).toBeGreaterThan(0);
  });

  it("paginates with cursors", async () => {
    const api = make();
    const first = await api.listThreads({ view: "inbox", limit: 10 });
    expect(first.nextCursor).toBe("10");
    const second = await api.listThreads({ view: "inbox", limit: 10, cursor: first.nextCursor! });
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
    const all = await api.listThreads({ view: "inbox", limit: 200 });
    expect(all.nextCursor).toBeNull();
  });

  it("covers every receipt state", async () => {
    const api = make();
    const tracked = await api.listTracked();
    const statuses = new Set(tracked.flatMap((t) => t.recipients.map((r) => r.status)));
    for (const s of ["sent", "opened", "replied", "unknowable"]) expect(statuses.has(s as never)).toBe(true);
    expect(tracked.some((t) => t.recipients.some((r) => r.possiblyForwarded))).toBe(true);
    const clients = new Set<string>();
    for (const t of tracked) for (const e of (await api.getReceipt(t.trackedId)).events) if (e.client) clients.add(e.client);
    expect(clients).toContain("Gmail");
    expect(clients).toContain("Outlook");
    expect(clients).toContain("Apple Mail");
    const opened = await api.listTracked({ status: "opened" });
    expect(opened.every((t) => t.summary.opened > 0)).toBe(true);
  });

  it("has signatures (one rich), templates, rules, agent activity awaiting approval", async () => {
    const api = make();
    const sigs = await api.listSignatures();
    expect(sigs.some((s) => s.html.includes("<img") && s.html.includes("<a "))).toBe(true);
    expect((await api.listTemplates()).length).toBeGreaterThan(1);
    expect((await api.listRules()).length).toBeGreaterThan(1);
    const activity = await api.listAgentActivity();
    expect(activity.some((a) => a.status === "awaiting_approval")).toBe(true);
    expect((await api.listScheduled()).some((s) => s.status === "awaiting_approval")).toBe(true);
  });
});

describe("mutations", () => {
  it("archives, emits mail_changed, and undoes", async () => {
    const api = make();
    const events = collect(api);
    const { items } = await api.listThreads({ view: "inbox", limit: 5 });
    const id = items[0]!.id;
    const { undoToken } = await api.archive([id]);
    expect(events.some((e) => e.type === "mail_changed" && e.threadIds.includes(id))).toBe(true);
    expect((await api.listThreads({ view: "inbox", limit: 200 })).items.some((i) => i.id === id)).toBe(false);
    expect((await api.listThreads({ view: "archive", limit: 200 })).items.some((i) => i.id === id)).toBe(true);
    await api.undo(undoToken);
    expect((await api.listThreads({ view: "inbox", limit: 200 })).items.some((i) => i.id === id)).toBe(true);
    await expect(api.undo(undoToken)).rejects.toThrow(/undo/i);
  });

  it("marks read, pins, mutes and snoozes", async () => {
    const api = make();
    const { items } = await api.listThreads({ view: "inbox", unreadOnly: true, limit: 5 });
    const id = items[0]!.id;
    await api.markRead([id], true);
    expect((await api.getThread(id)).messages.every((m) => m.seen)).toBe(true);
    await api.setPinned([id], true);
    expect((await api.listThreads({ view: "pinned", limit: 200 })).items.some((i) => i.id === id)).toBe(true);
    await api.setMuted([id], true);
    expect((await api.getThread(id)).muted).toBe(true);
    await api.snooze([id], NOW + 3_600_000);
    expect((await api.listThreads({ view: "inbox", limit: 200 })).items.some((i) => i.id === id)).toBe(false);
    expect((await api.listThreads({ view: "snoozed" })).items.some((i) => i.id === id)).toBe(true);
    await api.unsnooze([id]);
    expect((await api.listThreads({ view: "inbox", limit: 200 })).items.some((i) => i.id === id)).toBe(true);
  });

  it("blocks and unblocks senders", async () => {
    const api = make();
    await api.blockSender("tomas@northwind.dev");
    expect((await api.listBlocked()).some((b) => b.pattern === "tomas@northwind.dev")).toBe(true);
    const blocked = await api.listThreads({ view: "blocked" });
    expect(blocked.items.length).toBeGreaterThan(0);
    await api.unblockSender("tomas@northwind.dev");
    expect((await api.listBlocked()).some((b) => b.pattern === "tomas@northwind.dev")).toBe(false);
  });

  it("loads remote images for a message", async () => {
    const api = make();
    const { items } = await api.listThreads({ view: "search", search: "#212" });
    const msg = (await api.getThread(items[0]!.id)).messages[0]!;
    const out = await api.allowRemoteImages(msg.id, true);
    expect(out.remoteImages).toBe("allowed");
    expect(out.hasTrackers).toBe(false);
  });

  it("updates settings with a deep merge and emits the event", async () => {
    const api = make();
    const events = collect(api);
    const next = await api.updateSettings({ appearance: { theme: "light" }, ai: { smartReplies: false } });
    expect(next.appearance.theme).toBe("light");
    expect(next.appearance.density).toBe("comfortable");
    expect(events.find((e) => e.type === "settings")).toBeTruthy();
    expect((await api.getSettings()).ai.smartReplies).toBe(false);
  });

  it("adds and removes accounts, signatures, templates and rules", async () => {
    const api = make();
    const acct = await api.addAccount({ email: "new@fastmail.com", name: "New", password: "pw" });
    expect((await api.listAccounts()).length).toBe(4);
    expect((await api.listFolders(acct.id)).length).toBeGreaterThan(3);
    await expect(api.addAccount({ email: "new@fastmail.com", name: "New", password: "pw" })).rejects.toThrow(/already added/);
    await api.removeAccount(acct.id);
    expect((await api.listAccounts()).length).toBe(3);
    const sig = await api.saveSignature({ name: "Test", html: "x", accountIds: [], defaultNew: false, defaultReply: false });
    await api.saveSignature({ ...sig, name: "Renamed" });
    expect((await api.listSignatures()).find((s) => s.id === sig.id)!.name).toBe("Renamed");
    await api.deleteSignature(sig.id);
    const [first, second] = (await api.listAccounts()).map((a) => a.id);
    const shared = await api.saveSignature({ name: "Shared", html: "x", accountIds: [first!, second!], defaultNew: true, defaultReply: false });
    await expect(api.saveSignature({ name: "Bad", html: "x", accountIds: ["nope"], defaultNew: false, defaultReply: false })).rejects.toMatchObject({ code: "invalid" });
    expect((await api.listSignatures()).filter((s) => s.defaultNew && s.accountIds.includes(first!)).map((s) => s.id)).toEqual([shared.id]);
    const tpl = await api.saveTemplate({ name: "T", subject: "S", html: "h" });
    await api.deleteTemplate(tpl.id);
    const rule = await api.saveRule({ name: "R", enabled: true, accountId: null, match: "all", conditions: [], actions: [], sortOrder: 9 });
    await api.deleteRule(rule.id);
    expect((await api.listRules()).some((r) => r.id === rule.id)).toBe(false);
  });

  it("computes sidebar counts and folders", async () => {
    const api = make();
    const sidebar = await api.getSidebar();
    expect(sidebar.accounts).toHaveLength(3);
    expect(sidebar.counts.inbox).toBeGreaterThan(0);
    expect(sidebar.counts.awaitingApproval).toBe(1);
    expect(sidebar.accounts[0]!.folders.find((f) => f.role === "inbox")!.total).toBeGreaterThan(0);
    const home = await api.getHome();
    expect(home.unreadPeople.length).toBeGreaterThan(0);
    expect(home.pinned.length).toBeGreaterThan(0);
    expect(home.recentReceipts.length).toBeGreaterThan(0);
  });
});

describe("search", () => {
  it("supports operators", async () => {
    const api = make();
    const from = await api.listThreads({ view: "search", search: "from:carla" });
    expect(from.items.length).toBeGreaterThan(0);
    const unread = await api.listThreads({ view: "search", search: "is:unread has:attachment" });
    expect(unread.items.every((i) => i.unreadCount > 0 && i.hasAttachments)).toBe(true);
    const neg = await api.listThreads({ view: "search", search: 'invoice -"Invoice 2291"' });
    expect(neg.items.every((i) => !i.subject.includes("2291"))).toBe(true);
    const subj = await api.listThreads({ view: "search", search: "subject:roadmap" });
    expect(subj.items.map((i) => i.subject)).toContain("Q4 roadmap review: Thursday 2pm");
  });
});

describe("compose and send", () => {
  it("creates a reply draft with signature, recipients and quote", async () => {
    const api = make();
    const { items } = await api.listThreads({ view: "search", search: "Offsite venue" });
    const detail = await api.getThread(items[0]!.id);
    const last = detail.messages.at(-1)!;
    const draft = await api.createDraft({ mode: "replyAll", messageId: last.id });
    expect(draft.subject).toBe("Re: Offsite venue shortlist");
    expect(draft.to.map((a) => a.address)).toContain("sofia@northwind.dev");
    expect(draft.to.map((a) => a.address)).not.toContain("alex@northwind.dev");
    expect(draft.quotedHtml).toContain("wrote:");
    expect(draft.signatureId).toBeNull(); // the rich Northwind signature is for new mail only
    const fresh = await api.createDraft({ mode: "new", accountId: "acc_northwind" });
    expect(fresh.html).toContain("flint-signature");
    expect(fresh.signatureId).toBe(2);
    expect((await api.getThread(detail.id)).draftIds).toContain(draft.id);
  });

  it("creates new drafts from templates and edits and deletes them", async () => {
    const api = make();
    const draft = await api.createDraft({ mode: "new", accountId: "acc_orbit", templateId: 1, to: [{ name: "Hiro", address: "hiro@studio-orbit.com" }] });
    expect(draft.from).toBe("alex@studio-orbit.com");
    expect(draft.subject).toBe("Can we find 30 minutes?");
    const updated = await api.updateDraft(draft.id, { subject: "Changed", track: false });
    expect(updated.subject).toBe("Changed");
    const withFile = await api.addAttachment(draft.id, "/tmp/brief.pdf");
    expect(withFile.attachments[0]!.contentType).toBe("application/pdf");
    const without = await api.removeAttachment(draft.id, withFile.attachments[0]!.id);
    expect(without.attachments).toHaveLength(0);
    await api.deleteDraft(draft.id);
    await expect(api.getDraft(draft.id)).rejects.toThrow();
  });

  it("sends after the undo window, tracks it and files it in the thread", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const events = collect(api);
    const draft = await api.createDraft({ mode: "new", to: [{ name: "Priya Raman", address: "priya.raman@northwind.dev" }], subject: "Hello", html: "<p>Hi Priya</p>" });
    const before = (await api.listTracked()).length;
    const result = await api.sendDraft(draft.id);
    expect(result.status).toBe("pending");
    expect(result.undoUntil).toBe(NOW + 10_000);
    expect((await api.listDrafts()).some((d) => d.id === draft.id)).toBe(false);
    await vi.advanceTimersByTimeAsync(10_100);
    expect(events.some((e) => e.type === "send" && e.scheduled.status === "sent")).toBe(true);
    const sent = await api.listThreads({ view: "sent", limit: 5 });
    expect(sent.items[0]!.subject).toBe("Hello");
    expect(sent.items[0]!.receipt?.status).toBe("sent");
    expect((await api.listTracked()).length).toBe(before + 1);
  });

  it("cancels a pending send and returns the draft", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const draft = await api.createDraft({ mode: "new", to: [{ name: "X", address: "x@y.io" }], subject: "Oops" });
    const { scheduledId } = await api.sendDraft(draft.id);
    const back = await api.cancelSend(scheduledId);
    expect(back.id).toBe(draft.id);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await api.listThreads({ view: "sent", limit: 200 })).items.some((i) => i.subject === "Oops")).toBe(false);
    expect((await api.listDrafts()).some((d) => d.id === draft.id)).toBe(true);
  });

  it("keeps a reply out of the thread's drafts while its send is queued, and restores it on undo", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const page = await api.listThreads({ view: "inbox", limit: 20 });
    const thread = await api.getThread(page.items.find((i) => i.messageCount > 0 && i.id > 0)!.id);
    const target = thread.messages.findLast((m) => !m.isFromMe)!;
    const draft = await api.createDraft({ mode: "reply", messageId: target.id, html: "<p>On it</p>" });
    expect((await api.getThread(thread.id)).draftIds).toContain(draft.id);
    const { scheduledId } = await api.sendDraft(draft.id);
    expect((await api.getThread(thread.id)).draftIds).not.toContain(draft.id);
    await api.cancelSend(scheduledId);
    expect((await api.getThread(thread.id)).draftIds).toContain(draft.id);
  });

  it("rejects sends with no recipients", async () => {
    const api = make();
    const draft = await api.createDraft({ mode: "new" });
    await expect(api.sendDraft(draft.id)).rejects.toThrow(/recipient/);
  });

  it("approves and denies agent sends", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const events = collect(api);
    const waiting = (await api.listScheduled()).find((s) => s.status === "awaiting_approval")!;
    const next = await api.approveSend(waiting.id, true);
    expect(next.status).toBe("pending");
    expect(events.some((e) => e.type === "agent_activity" && e.activity.status === "approved")).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect((await api.listScheduled()).some((s) => s.id === waiting.id)).toBe(false);

    const api2 = make();
    const w2 = (await api2.listScheduled()).find((s) => s.status === "awaiting_approval")!;
    expect((await api2.approveSend(w2.id, false)).status).toBe("cancelled");
  });
});

describe("ai", () => {
  it("streams chunks over about a second, then done", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const chunks: Array<{ type: string; text?: string }> = [];
    api.subscribe((e) => e.type === "ai" && chunks.push(e.chunk));
    const { items } = await api.listThreads({ view: "search", search: "Freelancing" });
    const { runId } = await api.aiRun({ kind: "summarize", threadId: items[0]!.id });
    await vi.advanceTimersByTimeAsync(500);
    expect(chunks.filter((c) => c.type === "text").length).toBeGreaterThan(3);
    expect(chunks.some((c) => c.type === "done")).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    const done = chunks.find((c) => c.type === "done");
    expect(done?.text).toContain("Action needed");
    const streamed = chunks.filter((c) => c.type === "text").map((c) => c.text).join("");
    expect(streamed).toBe(done?.text);
    expect(runId).toMatch(/^run_/);
  });

  it("returns citations for ask, JSON for quick replies, and supports cancel", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const chunks: Array<{ type: string; text?: string }> = [];
    api.subscribe((e) => e.type === "ai" && chunks.push(e.chunk));
    await api.aiRun({ kind: "ask", question: "latest on cycle 3?" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(chunks.some((c) => c.type === "citations")).toBe(true);
    const { text } = await api.aiRunToText({ kind: "quickReplies", threadId: 1 });
    expect(JSON.parse(text)).toHaveLength(3);
    chunks.length = 0;
    const { runId } = await api.aiRun({ kind: "compose", prompt: "say hi" });
    await api.aiCancel(runId);
    await vi.advanceTimersByTimeAsync(2000);
    expect(chunks.some((c) => c.type === "done")).toBe(false);
  });

  it("covers the other task kinds and the connect flow", async () => {
    const api = make();
    expect((await api.aiRunToText({ kind: "rewrite", text: "One. Two.", style: "shorter" })).text).toBe("One.");
    expect((await api.aiRunToText({ kind: "rewrite", text: "Hello", style: "formal" })).text).toContain("formal");
    expect((await api.aiRunToText({ kind: "translate", text: "Hi", language: "French" })).text).toContain("French");
    expect((await api.aiRunToText({ kind: "reply", threadId: 1, instructions: "decline" })).text).toContain("decline");
    expect((await api.aiRunToText({ kind: "compose", prompt: "ask for the file" })).text).toContain("Ask for the file");
    expect((await api.aiSetModel("gpt-5.5-mini")).model).toBe("gpt-5.5-mini");
    await api.aiDisconnect();
    await expect(api.aiRun({ kind: "compose", prompt: "x" })).rejects.toMatchObject({ code: "ai_not_connected" });
    expect((await api.aiStartConnect("grok")).needsPaste).toBe(true);
    expect((await api.aiStartConnect("codex")).needsPaste).toBe(false);
    await expect(api.aiFinishConnect("grok", " ")).rejects.toThrow();
    expect((await api.aiFinishConnect("grok", "abc")).connected).toBe(true);
  });
});

describe("accounts and misc", () => {
  it("autoconfigs and tests connections", async () => {
    const api = make();
    expect((await api.autoconfig("a@gmail.com"))?.imapHost).toBe("imap.gmail.com");
    expect((await api.autoconfig("a@acme.io"))?.smtpHost).toBe("smtp.acme.io");
    expect(await api.autoconfig("nope")).toBeNull();
    expect((await api.testConnection({ email: "a@b.c", name: "A", password: "" })).imap).not.toBe("ok");
    expect((await api.testConnection({ email: "a@b.c", name: "A", password: "x" })).imap).toBe("ok");
  });

  it("syncs with status events", async () => {
    vi.useFakeTimers({ now: NOW });
    const api = make();
    const events = collect(api);
    const p = api.syncNow();
    await vi.advanceTimersByTimeAsync(800);
    await p;
    const states = events.flatMap((e) => (e.type === "sync" ? [e.status.state] : []));
    expect(states).toContain("syncing");
    expect(states.at(-1)).toBe("idle");
    expect((await api.getSyncStatus()).every((s) => s.state === "idle")).toBe(true);
  });

  it("suggests contacts, saves attachments, unsubscribes", async () => {
    const api = make();
    expect((await api.suggestContacts("car"))[0]!.email).toBe("carla@brightfield.studio");
    expect(await api.suggestContacts(" ")).toEqual([]);
    const { items } = await api.listThreads({ view: "search", search: "has:attachment" });
    const att = (await api.getThread(items[0]!.id)).messages.flatMap((m) => m.attachments)[0]!;
    expect(await api.saveAttachment(att.id)).toContain(att.filename);
    const news = await api.listThreads({ view: "inbox", category: "newsletters", limit: 50 });
    const m = (await api.getThread(news.items[0]!.id)).messages[0]!;
    expect((await api.unsubscribe(m.id)).method).toMatch(/one_click|browser/);
    expect(await api.agentInfo()).toHaveProperty("socketPath");
    expect((await api.installCli()).path).toBe("/usr/local/bin/flint");
    expect((await api.applyRules()).changed).toBeGreaterThanOrEqual(0);
  });

  it("stops tracking a message", async () => {
    const api = make();
    const [first] = await api.listTracked();
    await api.stopTracking(first!.trackedId);
    expect((await api.listTracked()).some((t) => t.trackedId === first!.trackedId)).toBe(false);
  });

  it("moves threads between folders and spam", async () => {
    const api = make();
    const { items } = await api.listThreads({ view: "inbox", limit: 3 });
    const ids = items.map((i) => i.id);
    await api.markSpam([ids[0]!], true);
    expect((await api.listThreads({ view: "spam", limit: 50 })).items.some((i) => i.id === ids[0])).toBe(true);
    await api.moveToInbox([ids[0]!]);
    await api.trash([ids[1]!]);
    const folders = await api.listFolders("acc_northwind");
    const clients = folders.find((f) => f.name === "Clients")!;
    await api.moveToFolder([ids[2]!], clients.id);
    expect((await api.listThreads({ view: "folder", folderId: clients.id, limit: 100 })).items.some((i) => i.id === ids[2])).toBe(true);
    await api.moveToFolder([ids[2]!], folders.find((f) => f.role === "inbox")!.id);
    await expect(api.moveToFolder([ids[2]!], 99999)).rejects.toThrow();
  });
});

describe("setCategory", () => {
  it("moves a thread between categories, with the sender's other inbox mail, and undoes it", async () => {
    const api = createMockApi({ now: Date.UTC(2026, 9, 25, 12), seed: 1 });
    const news = await api.listThreads({ view: "inbox", category: "newsletters", limit: 50 });
    const first = news.items[0]!;
    const { undoToken } = await api.setCategory([first.id], "people", { sender: true });
    const people = await api.listThreads({ view: "inbox", category: "people", limit: 200 });
    expect(people.items.some((i) => i.id === first.id)).toBe(true);
    await api.undo(undoToken);
    const back = await api.listThreads({ view: "inbox", category: "newsletters", limit: 50 });
    expect(back.items.some((i) => i.id === first.id)).toBe(true);
  });
});
