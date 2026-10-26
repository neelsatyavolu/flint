import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsAgent } from "../src/agent/context";
import type { FlintEvent, ThreadListItem } from "../src/types";
import { tryStartGreenMail, TEST_DOMAIN, type GreenMail } from "./greenmail";
import { waitFor } from "./harness";
import { addrOf, boot, header, mailbox, onServer, pixelToken, RECEIPTS_ENDPOINT, startWorker, unfold, type Rig } from "./service-compose-kit";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob", "carol", "dave", "erin"] });
afterAll(async () => { await gm?.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const person = (name: string) => ({ name: name[0]!.toUpperCase() + name.slice(1), address: addrOf(name) });

describe.skipIf(!gm)("compose and send against GreenMail", { timeout: 90_000 }, () => {
  let rig: Rig;
  let worker: Awaited<ReturnType<typeof startWorker>>;
  const svc = () => rig.service;
  const inbox = async (): Promise<ThreadListItem[]> => (await svc().listThreads({ view: "inbox" })).items;
  const inboxOf = (name: string) => mailbox(gm!, name, "INBOX");
  const waitInbox = (name: string, n = 1) => waitFor(async () => { const m = await inboxOf(name); return m.length >= n ? m : null; }, `${name} inbox`, 30_000);
  const sentEvents = (status: string): FlintEvent[] => rig.events.filter((e) => e.type === "send" && e.scheduled.status === status);
  const send = async (draftId: number, opts?: { sendAt?: number }) => {
    const queued = await svc().sendDraft(draftId, opts);
    rig.clock.advance(Math.max(0, queued.sendAt - rig.clock.now()) + 1000);
    await rig.nudge();
    return queued;
  };

  beforeAll(async () => {
    worker = await startWorker();
    rig = await boot(gm!, { fetch: worker.fetch, settings: { receipts: { enabled: true, defaultOn: true, endpoint: RECEIPTS_ENDPOINT } } });
  });
  afterAll(async () => { await rig?.service.stop(); });

  it("creates drafts with the default signature, templates and the creator", async () => {
    const sig = await svc().saveSignature({ name: "Work", html: "<p>Alice, Acme</p>", accountIds: [], defaultNew: true, defaultReply: true });
    const draft = await svc().createDraft({ mode: "new", to: [person("bob")], subject: "Hello" });
    expect(draft).toMatchObject({ accountId: rig.accountId, from: addrOf("alice"), mode: "new", track: true, createdBy: "user", signatureId: sig.id });
    expect(draft.html).toContain("flint_signature");
    expect(draft.html).toContain("Alice, Acme");

    const none = await svc().updateDraft(draft.id, { signatureId: null });
    expect(none.html).not.toContain("flint_signature");
    expect(none.signatureId).toBeNull();
    const back = await svc().updateDraft(draft.id, { signatureId: sig.id, html: `<p>Body</p>${none.html}` });
    expect(back.html.match(/flint_signature/g)).toHaveLength(1);

    const second = await svc().saveSignature({ name: "Short", html: "<p>A.</p>", accountIds: [], defaultNew: false, defaultReply: false });
    const swapped = await svc().updateDraft(draft.id, { signatureId: second.id });
    expect(swapped.html).toContain("<p>A.</p>");
    expect(swapped.html).not.toContain("Alice, Acme");
    expect(swapped.html).toContain("<p>Body</p>");

    const template = await svc().saveTemplate({ name: "Intro", subject: "Introductions", html: "<p>Nice to meet you</p>" });
    const fromTemplate = await svc().createDraft({ mode: "new", templateId: template.id });
    expect(fromTemplate.subject).toBe("Introductions");
    expect(fromTemplate.html).toContain("Nice to meet you");

    const byAgent = await runAsAgent("claude", () => svc().createDraft({ mode: "new", subject: "From an agent" }));
    expect(byAgent.createdBy).toBe("agent:claude");

    await svc().updateSettings({ receipts: { defaultOn: false } });
    expect((await svc().createDraft({ mode: "new" })).track).toBe(false);
    await svc().updateSettings({ receipts: { defaultOn: true } });

    for (const d of await svc().listDrafts()) await svc().deleteDraft(d.id);
    expect(await svc().listDrafts()).toEqual([]);
    await svc().deleteSignature(sig.id);
    await svc().deleteSignature(second.id);
  });

  it("validates draft edits and manages attachments", async () => {
    const draft = await svc().createDraft({ mode: "new" });
    await expect(svc().updateDraft(draft.id, { to: [{ name: "", address: "not an address" }] })).rejects.toMatchObject({ code: "invalid" });
    await expect(svc().updateDraft(draft.id, { from: "stranger@elsewhere.example" })).rejects.toMatchObject({ code: "invalid" });
    await expect(svc().sendDraft(draft.id)).rejects.toMatchObject({ code: "invalid" });
    await expect(svc().getDraft(99999)).rejects.toMatchObject({ code: "not_found" });

    const dir = mkdtempSync(join(tmpdir(), "flint-att-"));
    const file = join(dir, "notes.txt");
    writeFileSync(file, "hello");
    const withFile = await svc().addAttachment(draft.id, file);
    expect(withFile.attachments).toHaveLength(1);
    expect(withFile.attachments[0]).toMatchObject({ filename: "notes.txt", contentType: "text/plain", size: 5 });
    expect(withFile.attachments[0]!.path.startsWith(join(rig.dataDir, "drafts", String(draft.id)))).toBe(true);
    const twice = await svc().addAttachment(draft.id, file);
    expect(twice.attachments.map((a) => a.filename)).toEqual(["notes.txt", "notes (1).txt"]);
    await expect(runAsAgent("claude", () => svc().addAttachment(draft.id, file))).rejects.toMatchObject({ code: "permission" });
    await expect(svc().addAttachment(draft.id, dir)).rejects.toMatchObject({ code: "invalid" });
    await expect(svc().addAttachment(draft.id, join(dir, "missing.txt"))).rejects.toMatchObject({ code: "not_found" });

    const path = twice.attachments[1]!.path;
    const removed = await svc().removeAttachment(draft.id, twice.attachments[1]!.id);
    expect(removed.attachments).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
    await svc().deleteDraft(draft.id);
    expect(existsSync(join(rig.dataDir, "drafts", String(draft.id)))).toBe(false);
  });

  it("sends after the undo delay, can be cancelled, and delivers separate tracked copies", async () => {
    const draft = await svc().createDraft({ mode: "new", to: [person("bob")], subject: "Quarterly plan", html: "<p>Here is the plan</p>" });
    await svc().updateDraft(draft.id, { cc: [person("carol")], bcc: [person("dave")] });

    const first = await svc().sendDraft(draft.id);
    expect(first.status).toBe("pending");
    expect(first.sendAt - rig.clock.now()).toBeGreaterThan(3500);
    expect(first.sendAt - rig.clock.now()).toBeLessThanOrEqual(5000);
    expect(first.undoUntil).toBe(first.sendAt);
    expect((await svc().listScheduled()).map((s) => s.id)).toEqual([first.scheduledId]);
    await expect(svc().sendDraft(draft.id)).rejects.toMatchObject({ code: "conflict" });

    const back = await svc().cancelSend(first.scheduledId);
    expect(back.id).toBe(draft.id);
    expect(await svc().listScheduled()).toEqual([]);
    rig.clock.advance(60_000);
    await rig.nudge();
    await sleep(1500);
    expect(await inboxOf("bob")).toHaveLength(0);
    expect(await svc().listTracked()).toEqual([]);
    expect(worker.calls.filter((c) => c.includes("/v1/messages"))).toEqual([]);

    await send(draft.id);
    const [bob] = await waitInbox("bob");
    const [carol] = await waitInbox("carol");
    const [dave] = await waitInbox("dave");
    const tokens = [bob, carol, dave].map((m) => pixelToken(m!.source));
    expect(tokens.every((t) => t !== null)).toBe(true);
    expect(new Set(tokens).size).toBe(3);
    for (const m of [bob!, carol!, dave!]) {
      expect(header(m.source, "Message-ID")).toBe(header(bob!.source, "Message-ID"));
      expect(header(m.source, "To")).toContain(addrOf("bob"));
      expect(header(m.source, "Cc")).toContain(addrOf("carol"));
      expect(header(m.source, "Bcc")).toBeNull();
      expect(header(m.source, "X-Flint-Ref")).toBeTruthy();
      expect(unfold(m.source)).toContain("Here is the plan");
    }

    const sent = await waitFor(async () => { const m = await mailbox(gm!, "alice", "Sent"); return m.length ? m : null; }, "Sent copy");
    expect(sent).toHaveLength(1);
    expect(pixelToken(sent[0]!.source)).toBeNull();
    expect(sent[0]!.flags).toContain("\\Seen");

    const tracked = await svc().listTracked();
    expect(tracked).toHaveLength(1);
    expect(tracked[0]!.subject).toBe("Quarterly plan");
    expect(tracked[0]!.recipients.map((r) => r.email).sort()).toEqual([addrOf("bob"), addrOf("carol"), addrOf("dave")]);
    expect(tracked[0]!.recipients.every((r) => r.status === "sent")).toBe(true);
    expect((worker.raw.prepare("SELECT COUNT(*) AS n FROM tokens").get() as { n: number }).n).toBe(3);

    await waitFor(async () => (await svc().listDrafts()).every((d) => d.id !== draft.id), "the sent draft to be removed");
    expect(sentEvents("sent")).toHaveLength(1);
    await waitFor(async () => (await svc().listThreads({ view: "sent" })).items.some((t) => t.subject === "Quarterly plan"), "the sent thread");
  });

  it("replies in the thread with the right headers and marks the original answered", async () => {
    await gm!.deliver({ to: addrOf("alice"), from: "Bob <bob@test.local>", subject: "Lunch plans", text: "Where shall we eat?", messageId: "<lunch-1@remote.example>" });
    const thread = await waitFor(async () => (await inbox()).find((t) => t.subject === "Lunch plans"), "the lunch thread", 30_000);
    const original = (await svc().getThread(thread.id)).messages[0]!;

    const draft = await svc().createDraft({ mode: "reply", messageId: original.id, html: "<p>Tacos?</p>" });
    expect(draft).toMatchObject({ mode: "reply", subject: "Re: Lunch plans", sourceMessageId: original.id, threadId: thread.id });
    expect(draft.to.map((a) => a.address)).toEqual([addrOf("bob")]);
    expect(draft.quotedHtml).toContain("wrote:");
    expect(draft.quotedHtml).toContain("Where shall we eat?");
    await send(draft.id);

    const received = await waitFor(async () => (await inboxOf("bob")).find((m) => header(m.source, "Subject") === "Re: Lunch plans"), "the reply", 30_000);
    expect(header(received.source, "In-Reply-To")).toBe("<lunch-1@remote.example>");
    expect(header(received.source, "References")).toContain("<lunch-1@remote.example>");
    expect(unfold(received.source)).toContain("Tacos?");
    expect(unfold(received.source)).toContain("Where shall we eat?");

    const answered = await waitFor(async () => (await inboxOf("alice")).find((m) => header(m.source, "Subject") === "Lunch plans" && m.flags.includes("\\Answered")), "the answered flag", 30_000);
    expect(answered).toBeTruthy();
    const detail = await waitFor(async () => { const t = await svc().getThread(thread.id); return t.messages.length >= 2 ? t : null; }, "the sent reply in the thread", 30_000);
    expect(detail.messages.at(-1)!.isFromMe).toBe(true);
    const tracked = (await svc().listTracked()).find((t) => t.subject === "Re: Lunch plans");
    expect(tracked?.threadId).toBe(thread.id);
  });

  it("forwards a message with its attachment", async () => {
    await gm!.deliver({
      to: addrOf("alice"), from: "Omar <omar@remote.example>", subject: "Signed contract", text: "See attached",
      attachments: [{ filename: "contract.txt", content: "agreed terms", contentType: "text/plain" }],
    });
    const thread = await waitFor(async () => (await inbox()).find((t) => t.subject === "Signed contract"), "the contract thread", 30_000);
    const original = (await svc().getThread(thread.id)).messages[0]!;

    const draft = await svc().createDraft({ mode: "forward", messageId: original.id });
    expect(draft.subject).toBe("Fwd: Signed contract");
    expect(draft.to).toEqual([]);
    expect(draft.quotedHtml).toContain("Forwarded message");
    expect(draft.attachments).toHaveLength(1);
    expect(draft.attachments[0]).toMatchObject({ filename: "contract.txt", size: 12 });
    expect(existsSync(draft.attachments[0]!.path)).toBe(true);

    await svc().updateDraft(draft.id, { to: [person("erin")] });
    await send(draft.id);
    const [mail] = await waitInbox("erin");
    expect(header(mail!.source, "Subject")).toBe("Fwd: Signed contract");
    expect(mail!.source).toContain("contract.txt");
    expect(Buffer.from(mail!.source.split(/filename="?contract\.txt"?/i)[1]!.split(/\r?\n\r?\n/)[1]!.split(/\r?\n--/)[0]!.replace(/\s+/g, ""), "base64").toString()).toBe("agreed terms");
  });

  it("sends later at a future time", async () => {
    const draft = await svc().createDraft({ mode: "new", to: [person("erin")], subject: "Scheduled hello", html: "<p>Later</p>" });
    const at = rig.clock.now() + 3 * 3600_000;
    const queued = await svc().sendDraft(draft.id, { sendAt: at });
    expect(queued).toMatchObject({ sendAt: at, undoUntil: at, status: "pending" });
    rig.clock.advance(3600_000);
    await rig.nudge();
    await sleep(1500);
    expect((await inboxOf("erin")).some((m) => header(m.source, "Subject") === "Scheduled hello")).toBe(false);
    expect((await svc().listScheduled())[0]).toMatchObject({ id: queued.scheduledId, status: "pending", subject: "Scheduled hello" });

    rig.clock.advance(2 * 3600_000 + 5000);
    await rig.nudge();
    await waitFor(async () => (await inboxOf("erin")).some((m) => header(m.source, "Subject") === "Scheduled hello"), "the scheduled mail", 30_000);
  });

  it("holds an agent's send for approval, then sends it once approved", async () => {
    await svc().updateSettings({ agents: { send: "ask" } });
    const draft = await runAsAgent("claude", () => svc().createDraft({ mode: "new", to: [person("erin")], subject: "Agent note", html: "<p>Drafted by an agent</p>" }));
    const queued = await runAsAgent("claude", () => svc().sendDraft(draft.id));
    expect(queued.status).toBe("awaiting_approval");
    const row = (await svc().listScheduled()).find((s) => s.id === queued.scheduledId)!;
    expect(row).toMatchObject({ status: "awaiting_approval", requestedBy: "agent:claude" });
    rig.clock.advance(60_000);
    await rig.nudge();
    await sleep(1500);
    expect((await inboxOf("erin")).some((m) => header(m.source, "Subject") === "Agent note")).toBe(false);

    await svc().approveSend(queued.scheduledId, true);
    rig.clock.advance(10_000);
    await rig.nudge();
    await waitFor(async () => (await inboxOf("erin")).some((m) => header(m.source, "Subject") === "Agent note"), "the approved mail", 30_000);
    await expect(svc().approveSend(queued.scheduledId, true)).rejects.toBeTruthy();

    const denied = await runAsAgent("claude", () => svc().createDraft({ mode: "new", to: [person("erin")], subject: "Denied note" }));
    const q2 = await runAsAgent("claude", () => svc().sendDraft(denied.id));
    const after = await svc().approveSend(q2.scheduledId, false);
    expect(after.status).toBe("cancelled");
    await svc().deleteDraft(denied.id);

    await svc().updateSettings({ agents: { send: "deny" } });
    const another = await svc().createDraft({ mode: "new", to: [person("erin")], subject: "x" });
    await expect(runAsAgent("claude", () => svc().sendDraft(another.id))).rejects.toMatchObject({ code: "permission" });
    await svc().deleteDraft(another.id);
    await svc().updateSettings({ agents: { send: "allow" } });
  });

  it("keeps a copy of an edited draft in the server Drafts folder and removes it on delete", async () => {
    const draft = await svc().createDraft({ mode: "new", to: [person("bob")], subject: "Server copy", html: "<p>work in progress</p>" });
    await svc().updateDraft(draft.id, { html: "<p>work in progress, edited</p>" });
    const copies = await waitFor(async () => { const m = await mailbox(gm!, "alice", "Drafts"); return m.length ? m : null; }, "the server draft", 25_000);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.flags).toContain("\\Draft");
    expect(header(copies[0]!.source, "Subject")).toBe("Server copy");
    expect(unfold(copies[0]!.source)).toContain("edited");

    await svc().deleteDraft(draft.id);
    await waitFor(async () => (await mailbox(gm!, "alice", "Drafts")).length === 0, "the server draft to be removed", 15_000);
  });

  it("lists server and local drafts once each and opens a server draft linked to its copy", async () => {
    const draftsView = async (): Promise<ThreadListItem[]> => (await svc().listThreads({ view: "drafts" })).items;
    const bySubject = async (subject: string): Promise<ThreadListItem[]> => (await draftsView()).filter((i) => i.subject === subject);
    const raw = [
      `From: Alice <${addrOf("alice")}>`, `To: Bob <${addrOf("bob")}>`, "Subject: Started in Gmail web", "Message-ID: <web-draft-1@gmail.example>",
      "Date: Mon, 26 Oct 2026 09:00:00 +0000", "MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "", "<p>Half a thought from the web</p>", "",
    ].join("\r\n");
    await onServer(gm!, "alice", async (c) => { await c.mailboxCreate("Drafts").catch(() => undefined); await c.append("Drafts", Buffer.from(raw), ["\\Draft", "\\Seen"]); });
    await svc().syncNow();
    const serverRow = (await waitFor(async () => { const r = await bySubject("Started in Gmail web"); return r.length ? r : null; }, "the server draft in the Drafts view", 30_000))[0]!;
    expect(serverRow.draft).toMatchObject({ draftId: null });
    expect(serverRow.draft!.messageId).toBeGreaterThan(0);

    const local = await svc().createDraft({ mode: "new", to: [person("carol")], subject: "Local only" });
    const localRow = (await bySubject("Local only"))[0]!;
    expect(localRow.draft).toEqual({ draftId: local.id, messageId: null });
    expect((await svc().getSidebar()).counts.drafts).toBe((await draftsView()).length);

    const opened = await svc().openServerDraft(serverRow.draft!.messageId!);
    expect(opened).toMatchObject({ subject: "Started in Gmail web", accountId: rig.accountId });
    expect(opened.to.map((a) => a.address)).toEqual([addrOf("bob")]);
    expect(opened.html).toContain("Half a thought from the web");
    expect((await svc().openServerDraft(serverRow.draft!.messageId!)).id).toBe(opened.id);
    const after = await bySubject("Started in Gmail web");
    expect(after).toHaveLength(1);
    expect(after[0]!.draft).toEqual({ draftId: opened.id, messageId: null });
    expect((await svc().getSidebar()).counts.drafts).toBe((await draftsView()).length);

    await svc().updateDraft(opened.id, { html: "<p>Finished in Flint</p>" });
    const copies = await waitFor(async () => {
      const m = (await mailbox(gm!, "alice", "Drafts")).filter((x) => header(x.source, "Subject") === "Started in Gmail web");
      return m.length === 1 && unfold(m[0]!.source).includes("Finished in Flint") ? m : null;
    }, "the server copy to be replaced, not duplicated", 30_000);
    expect(copies).toHaveLength(1);
    await svc().syncNow();
    await sleep(1500);
    expect(await bySubject("Started in Gmail web")).toHaveLength(1);

    await svc().deleteDraft(opened.id);
    await svc().deleteDraft(local.id);
    await waitFor(async () => (await mailbox(gm!, "alice", "Drafts")).length === 0, "the server drafts to be removed", 15_000);
  });

  it("saves rules with validation and applies them to the inbox", async () => {
    await expect(svc().saveRule({ name: "bad", enabled: true, accountId: null, match: "all", conditions: [{ field: "subject", op: "matches", value: "(" }], actions: [{ type: "archive" }], sortOrder: 0 })).rejects.toMatchObject({ code: "invalid" });
    await expect(svc().saveRule({ name: "bad", enabled: true, accountId: "nope", match: "all", conditions: [{ field: "subject", op: "contains", value: "x" }], actions: [{ type: "archive" }], sortOrder: 0 })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc().saveRule({ name: "", enabled: true, accountId: null, match: "all", conditions: [], actions: [], sortOrder: 0 })).rejects.toMatchObject({ code: "invalid" });

    await gm!.deliver({ to: addrOf("alice"), from: "Promo <promo@shop.example>", subject: "Big sale today", text: "Everything must go" });
    await gm!.deliver({ to: addrOf("alice"), from: "Dana <dana@remote.example>", subject: "Stay in the inbox", text: "Personal" });
    await waitFor(async () => { const s = (await inbox()).map((t) => t.subject); return s.includes("Big sale today") && s.includes("Stay in the inbox"); }, "both rule candidates", 30_000);

    const rule = await svc().saveRule({
      name: "Promos", enabled: true, accountId: null, match: "all",
      conditions: [{ field: "from", op: "contains", value: "promo@shop.example" }], actions: [{ type: "mark_read" }, { type: "archive" }], sortOrder: 0,
    });
    expect((await svc().listRules()).map((r) => r.id)).toContain(rule.id);
    expect(await svc().applyRules(rule.id)).toEqual({ changed: 1 });
    const subjects = (await inbox()).map((t) => t.subject);
    expect(subjects).not.toContain("Big sale today");
    expect(subjects).toContain("Stay in the inbox");
    await waitFor(async () => (await mailbox(gm!, "alice", "Archive")).some((m) => header(m.source, "Subject") === "Big sale today"), "the archived mail on the server");
    expect(await svc().applyRules()).toEqual({ changed: 0 });
    await svc().deleteRule(rule.id);
    expect(await svc().listRules()).toEqual([]);
  });

  it("unsubscribes by mailto through the compose hook", async () => {
    await gm!.deliver({
      to: addrOf("alice"), from: "Letter <letter@news.example>", subject: "Weekly letter", text: "News",
      headers: { "List-Unsubscribe": `<mailto:${addrOf("erin")}?subject=remove%20me>`, "List-Id": "letter.news.example" },
    });
    const thread = await waitFor(async () => (await inbox()).find((t) => t.subject === "Weekly letter"), "the newsletter", 30_000);
    const msg = (await svc().getThread(thread.id)).messages[0]!;
    expect(await svc().unsubscribe(msg.id)).toEqual({ method: "mailto" });
    const mail = await waitFor(async () => (await inboxOf("erin")).find((m) => header(m.source, "Subject") === "remove me"), "the unsubscribe mail", 30_000);
    expect(header(mail.source, "From")).toContain(addrOf("alice"));
    expect(pixelToken(mail.source)).toBeNull();
  });
});

void TEST_DOMAIN;
