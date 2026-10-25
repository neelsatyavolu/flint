import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_GUIDE } from "./agent-guide";
import { FlintError } from "@flint/core/types";
import { AppNotRunningError } from "@flint/core/agent/client";
import { exec, fakeClient, NOW } from "./test-util";

const addr = (name: string, address: string) => ({ name, address });
const item = (over: Record<string, unknown> = {}) => ({
  id: 7, accountId: "a1", subject: "Invoice", snippet: "", participants: [addr("Cindy", "c@x.co")], lastDate: NOW.getTime() - 3600_000,
  messageCount: 2, unreadCount: 1, hasAttachments: true, pinned: false, muted: false, snoozedUntil: null, category: "people", hasDraft: false, receipt: null, ...over,
});
const page = (items: unknown[]) => ({ items, bundles: [], nextCursor: null });
const message = (over: Record<string, unknown> = {}) => ({
  id: 70, from: [addr("Cindy", "c@x.co")], to: [addr("", "me@x.co")], cc: [], date: NOW.getTime(), text: "Hello there", html: null, snippet: "", bodyLoaded: true,
  attachments: [{ id: 12, filename: "a.pdf", size: 4096 }], isFromMe: false, ...over,
});
const thread = { id: 7, accountId: "a1", subject: "Invoice", messages: [message({ id: 69, isFromMe: true }), message()] };

describe("list and search", () => {
  it("builds the query and prints a table", async () => {
    const f = fakeClient({ listThreads: page([item()]), listAccounts: [{ id: "a1", email: "me@x.co" }] });
    const r = await exec(["list", "--unread", "--view", "pinned", "--account", "me@x.co", "--category", "people", "--limit", "5"], f);
    expect(r.code).toBe(0);
    expect(f.calls.at(-1)?.params[0]).toMatchObject({ view: "pinned", accountId: "a1", unreadOnly: true, category: "people", limit: 5 });
    expect(r.out).toContain("ID");
    expect(r.out).toMatch(/7\s+\*\s*\+\s+09:00\s+Cindy\s+Invoice \(2\)/);
  });
  it("sends no account without --account, so core leaves out accounts hidden from the unified inbox", async () => {
    const f = fakeClient({ listThreads: page([item()]), listAccounts: [{ id: "a1", email: "me@x.co" }] });
    await exec(["list"], f);
    expect((f.calls.at(-1)?.params[0] as { accountId?: string }).accountId).toBeUndefined();
    await exec(["list", "--account", "me@x.co"], f);
    expect((f.calls.at(-1)?.params[0] as { accountId?: string }).accountId).toBe("a1");
  });
  it("prints JSON and defaults the agent to cli", async () => {
    const f = fakeClient({ listThreads: page([item()]) });
    const r = await exec(["list", "--json"], f);
    expect(JSON.parse(r.out).items[0].id).toBe(7);
    expect(r.agents).toEqual(["cli"]);
  });
  it("accepts global --json and --as, and FLINT_AGENT", async () => {
    const f = fakeClient({ listThreads: page([]) });
    const a = await exec(["--json", "--as", "claude", "list"], f);
    expect(a.agents).toEqual(["claude"]);
    expect(JSON.parse(a.out).items).toEqual([]);
    expect((await exec(["list"], f, { env: { FLINT_AGENT: "codex" } })).agents).toEqual(["codex"]);
    expect((await exec(["list"], f)).out).toBe("No threads.\n");
  });
  it("validates view, category, limit", async () => {
    const f = fakeClient();
    expect((await exec(["list", "--view", "nope"], f)).err).toMatch(/Unknown view/);
    expect((await exec(["list", "--category", "x"], f)).err).toMatch(/Unknown category/);
    expect((await exec(["list", "--limit", "0"], f)).code).toBe(1);
  });
  it("rejects an empty query and warns about unsupported operators", async () => {
    const f = fakeClient({ listThreads: page([]) });
    const empty = await exec(["search", "  "], f);
    expect(empty.code).toBe(1);
    expect(empty.err).toMatch(/Give a search query/);
    expect(f.calls).toHaveLength(0);
    const r = await exec(["search", "filename:menu.pdf label:foo from:cindy after:nope", "--json"], f);
    expect(r.code).toBe(0);
    expect(r.err).toContain("filename:menu.pdf, label:foo");
    expect(r.err).not.toContain("from:cindy,");
    expect(r.err).toContain("after:nope");
    expect(JSON.parse(r.out).items).toEqual([]);
    expect((await exec(["search", "from:cindy has:attachment http://x.co"], f)).err).toBe("");
  });
  it("search --server asks the mail server first, then lists", async () => {
    const f = fakeClient({ searchServer: { found: 2, added: 2 }, listThreads: { items: [], bundles: [], nextCursor: null } });
    const r = await exec(["search", "from:old@x.com", "--server"], f);
    expect(f.calls.map((c) => c.method)).toEqual(["searchServer", "listThreads"]);
    expect(f.calls[0]?.params[0]).toBe("from:old@x.com");
    expect(r.err).toMatch(/Fetched 2 older messages/);
  });

  it("searches", async () => {
    const f = fakeClient({ listThreads: page([item()]) });
    await exec(["search", "from:cindy", "--limit", "3"], f);
    expect(f.calls[0]?.params[0]).toEqual({ view: "search", search: "from:cindy", limit: 3 });
  });
});

describe("read", () => {
  it("prints messages as text", async () => {
    const f = fakeClient({ getThread: thread });
    const r = await exec(["read", "7"], f);
    expect(r.out).toContain("Invoice");
    expect(r.out).toContain("From: Cindy <c@x.co>");
    expect(r.out).toContain("Attachments: a.pdf (4 KB, attachment 12)");
    expect(r.out).toContain("Message 70");
    expect(r.out).toContain("Hello there");
  });
  it("converts html and honors --raw", async () => {
    const f = fakeClient({ getThread: { ...thread, messages: [message({ text: null, html: "<p>Hi <b>you</b></p>" })] } });
    expect((await exec(["read", "7"], f)).out).toContain("Hi you");
    expect((await exec(["read", "7", "--raw"], f)).out).toContain("<p>Hi <b>you</b></p>");
  });
  it("keeps heading case and separates table cells in HTML mail", async () => {
    const html = "<h1>Hi There</h1><table><tr><td>a</td><td>b</td></tr><tr><td>Total</td><td>$5</td></tr></table>";
    const f = fakeClient({ getThread: { ...thread, messages: [message({ text: null, html })] } });
    const out = (await exec(["read", "7"], f)).out;
    expect(out).toContain("Hi There");
    expect(out).not.toContain("HI THERE");
    expect(out).toMatch(/a\s{2,}b/);
    expect(out).toMatch(/Total\s{2,}\$5/);
  });
  it("rejects a bad id", async () => {
    expect((await exec(["read", "abc"], fakeClient())).err).toMatch(/isn't a thread id/);
  });
});

describe("compose", () => {
  const draft = { id: 12, to: [addr("", "a@b.co")], subject: "Hi" };
  it("creates a draft with cc and body file", async () => {
    const f = fakeClient({ createDraft: draft, updateDraft: draft, listAccounts: [{ id: "a1", email: "me@x.co" }] });
    const r = await exec(["draft", "--to", "a@b.co,Cindy <c@x.co>", "--cc", "d@e.co", "--subject", "Hi", "--body-file", "n.txt", "--account", "me@x.co"], f);
    expect(f.calls.find((c) => c.method === "createDraft")?.params[0]).toMatchObject({
      mode: "new", accountId: "a1", subject: "Hi", html: "<p>file body</p>", to: [addr("", "a@b.co"), addr("Cindy", "c@x.co")],
    });
    expect(f.calls.find((c) => c.method === "updateDraft")?.params).toEqual([12, { cc: [addr("", "d@e.co")] }]);
    expect(r.out).toContain("Draft 12 created.");
    expect(r.out).toContain("flint send 12");
  });
  it("validates recipients and body options", async () => {
    const f = fakeClient({ createDraft: draft });
    expect((await exec(["draft", "--body", "x"], f)).err).toMatch(/Add a recipient/);
    expect((await exec(["draft", "--to", "nope"], f)).err).toMatch(/isn't an email/);
    expect((await exec(["draft", "--to", "a@b.co", "--body", "x", "--body-file", "f"], f)).err).toMatch(/not both/);
  });
  it("replies to the latest message from someone else", async () => {
    const f = fakeClient({ getThread: thread, createDraft: draft });
    await exec(["reply", "7", "--all", "--body", "Thanks"], f);
    expect(f.calls.find((c) => c.method === "createDraft")?.params[0]).toEqual({ mode: "replyAll", messageId: 70, html: "<p>Thanks</p>" });
  });
  it("forwards with a recipient", async () => {
    const f = fakeClient({ getThread: thread, createDraft: draft, updateDraft: draft });
    await exec(["forward", "7", "--to", "z@z.co"], f);
    expect(f.calls.find((c) => c.method === "updateDraft")?.params).toEqual([12, { to: [addr("", "z@z.co")] }]);
    expect((await exec(["forward", "7"], f)).err).toMatch(/Add a recipient/);
  });
});

describe("send", () => {
  const sent = (status: string) => ({ scheduledId: 3, sendAt: new Date(2026, 9, 26, 9, 0).getTime(), undoUntil: 0, status });
  it("sends a draft later", async () => {
    const f = fakeClient({ sendDraft: sent("pending") });
    const r = await exec(["send", "12", "--at", "2026-10-26 09:00"], f);
    expect(f.calls[0]).toEqual({ method: "sendDraft", params: [12, { sendAt: new Date(2026, 9, 26, 9, 0).getTime() }] });
    expect(r.out).toBe("Queued draft 12. It sends at 2026-10-26 09:00.\n");
  });
  it("reports approval and rejects past times", async () => {
    const f = fakeClient({ sendDraft: sent("awaiting_approval") });
    expect((await exec(["send", "12"], f)).out).toMatch(/waiting for your approval/);
    expect((await exec(["send", "12", "--at", "2026-10-01"], f)).err).toMatch(/in the past/);
  });
  it("drafts and sends in one step", async () => {
    const f = fakeClient({ createDraft: { id: 20 }, sendDraft: sent("pending") });
    await exec(["send", "--to", "a@b.co", "--subject", "Hi", "--body", "Yo"], f);
    expect(f.calls.map((c) => c.method)).toEqual(["createDraft", "sendDraft"]);
    expect(f.calls[1]?.params).toEqual([20, undefined]);
  });
  it("needs a draft id or recipient, not both", async () => {
    const f = fakeClient();
    expect((await exec(["send"], f)).err).toMatch(/Give a draft id/);
    expect((await exec(["send", "1", "--to", "a@b.co"], f)).err).toMatch(/not both/);
  });
});

describe("actions", () => {
  it.each([
    ["archive", "archive", [[1, 2]]],
    ["trash", "trash", [[1, 2]]],
    ["pin", "setPinned", [[1, 2], true]],
    ["unpin", "setPinned", [[1, 2], false]],
    ["mark-read", "markRead", [[1, 2], true]],
    ["unread", "markRead", [[1, 2], false]],
    ["spam", "markSpam", [[1, 2], true]],
  ])("%s", async (cmd, method, params) => {
    const f = fakeClient({ [method]: { undoToken: "u" } });
    const r = await exec([cmd, "1", "2"], f);
    expect(f.calls[0]).toEqual({ method, params });
    expect(r.out).toContain("2 threads");
    expect(r.out).toContain("Undo: flint undo u");
  });
  it.each([
    ["mute", "setMuted", [[1, 2], true]],
    ["unmute", "setMuted", [[1, 2], false]],
    ["unsnooze", "unsnooze", [[1, 2]]],
  ])("%s", async (cmd, method, params) => {
    const f = fakeClient({ [method]: { undoToken: "u" } });
    await exec([cmd, "1", "2"], f);
    expect(f.calls[0]).toEqual({ method, params });
  });
  it("snoozes", async () => {
    const f = fakeClient({ snooze: { undoToken: "u" } });
    const r = await exec(["snooze", "5", "tomorrow"], f);
    expect(f.calls[0]).toEqual({ method: "snooze", params: [[5], new Date(2026, 9, 26, 8).getTime()] });
    expect(r.out).toBe("Snoozed thread 5 until 2026-10-26 08:00. Undo: flint undo u\n");
    expect((await exec(["snooze", "5", "yesterday"], f)).code).toBe(1);
  });
  it("categorizes a thread, optionally for the sender", async () => {
    const f = fakeClient({ setCategory: { undoToken: "u" } });
    expect((await exec(["categorize", "7", "Notifications"], f)).out).toBe("Moved thread 7 to notifications. Undo: flint undo u\n");
    expect(f.calls.at(-1)).toEqual({ method: "setCategory", params: [[7], "notifications", undefined] });
    await exec(["categorize", "7", "people", "--sender"], f);
    expect(f.calls.at(-1)).toEqual({ method: "setCategory", params: [[7], "people", { sender: true }] });
    expect((await exec(["categorize", "7", "spam"], f)).err).toMatch(/Category must be one of/);
  });

  it("moves to a folder, by name or inbox", async () => {
    const f = fakeClient({ getThread: thread, listFolders: [{ id: 4, name: "Receipts", path: "Receipts", role: null }, { id: 5, name: "Archive", path: "A", role: "archive" }], moveToFolder: { undoToken: "u" }, moveToInbox: { undoToken: "u" } });
    expect((await exec(["move", "7", "receipts"], f)).out).toBe("Moved thread 7 to Receipts. Undo: flint undo u\n");
    expect(f.calls.at(-1)).toEqual({ method: "moveToFolder", params: [[7], 4] });
    await exec(["move", "7", "archive"], f);
    expect(f.calls.at(-1)?.params).toEqual([[7], 5]);
    await exec(["move", "7", "inbox"], f);
    expect(f.calls.at(-1)?.method).toBe("moveToInbox");
    expect((await exec(["move", "7", "nope"], f)).err).toMatch(/No folder "nope"/);
  });
});

describe("misc commands", () => {
  it("status and accounts", async () => {
    const f = fakeClient({
      getSyncStatus: [{ accountId: "a1", state: "idle", lastSyncAt: NOW.getTime() }],
      getSidebar: { accounts: [{ account: { id: "a1", email: "me@x.co" } }], counts: { inbox: 3, pinned: 1, drafts: 0, snoozed: 2, scheduled: 0, awaitingApproval: 1, spam: 0 } },
      listAccounts: [{ id: "a1", email: "me@x.co", name: "Me", provider: "gmail", enabled: true }],
    });
    const s = await exec(["status"], f);
    expect(s.out).toContain("Flint is running.");
    expect(s.out).toContain("me@x.co  idle, last sync 10:00");
    expect(s.out).toContain("awaiting approval 1");
    expect((await exec(["accounts"], f)).out).toMatch(/a1\s+me@x.co\s+Me\s+gmail\s+yes/);
    expect(JSON.parse((await exec(["status", "--json"], f)).out).running).toBe(true);
  });
  it("receipts list and detail", async () => {
    const f = fakeClient({
      listTracked: [{ trackedId: 3, sentAt: NOW.getTime(), subject: "Proposal", summary: { status: "opened", opened: 1, total: 2 } }],
      getReceipt: { trackedId: 3, sentAt: NOW.getTime(), recipients: [{ email: "a@b.co", status: "opened", openCount: 2, firstOpenAt: NOW.getTime(), possiblyForwarded: true, note: null }], events: [] },
    });
    expect((await exec(["receipts"], f)).out).toMatch(/3\s+10:00\s+opened\s+1\/2\s+Proposal/);
    expect((await exec(["receipts", "3"], f)).out).toMatch(/a@b.co\s+opened\s+2.*may have been forwarded/);
  });
  it("summarize, ask, activity", async () => {
    const f = fakeClient({
      aiRunToText: (task: unknown) => ({ text: (task as { kind: string }).kind === "ask" ? "Answer" : "Summary" }),
      listAgentActivity: [{ id: 1, at: NOW.getTime(), agent: "cli", status: "ok", summary: "Archived 3 threads" }],
    });
    expect((await exec(["summarize", "7"], f)).out).toBe("Summary\n");
    expect((await exec(["ask", "who?"], f)).out).toBe("Answer\n");
    expect((await exec(["activity"], f)).out).toMatch(/1\s+10:00\s+cli\s+ok\s+Archived 3 threads/);
  });
  it("watch prints JSON lines and exits 2 when the stream ends", async () => {
    const ev = { type: "toast", level: "info", message: "x" } as const;
    const r = await exec(["watch"], fakeClient({}, [ev, ev]));
    expect(r.out.trim().split("\n").map((l) => JSON.parse(l))).toEqual([ev, ev]);
    expect(r.code).toBe(2);
  });
  it("watch filters by type", async () => {
    const toast = { type: "toast", level: "info", message: "x" } as const;
    const mail = { type: "new_mail", accountId: "a", threadId: 1, from: { name: "", address: "a@b.co" }, subject: "s", category: "people" } as const;
    const r = await exec(["watch", "--type", "new_mail"], fakeClient({}, [toast, mail]));
    expect(r.out.trim().split("\n").map((l) => JSON.parse(l).type)).toEqual(["new_mail"]);
    expect((await exec(["watch", "--type", "nope"], fakeClient())).err).toMatch(/Unknown event type nope/);
  });
  it("watch --reconnect retries with backoff until a real error", async () => {
    const toast = { type: "toast", level: "info", message: "x" } as const;
    let n = 0;
    const f = fakeClient();
    (f.client as unknown as { events: () => AsyncIterable<unknown> }).events = async function* () {
      n++;
      if (n === 1) yield toast;
      else if (n === 2) throw new AppNotRunningError();
      else if (n === 3) yield toast;
      else throw new FlintError("auth", "bad token");
    };
    const sleeps: number[] = [];
    const r = await exec(["watch", "--reconnect"], f, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(r.out.trim().split("\n")).toHaveLength(2);
    expect(sleeps).toEqual([500, 1000, 500]);
    expect(r.code).toBe(1);
  });
});

describe("errors and exit codes", () => {
  it("maps app-not-running to exit 2", async () => {
    const f = fakeClient({ listAccounts: () => { throw new AppNotRunningError(); } });
    const r = await exec(["accounts"], f);
    expect(r.code).toBe(2);
    expect(r.err).toBe("Flint isn't running. Open Flint, then try again.\n");
  });
  it("maps other errors to exit 1, as JSON with --json", async () => {
    const f = fakeClient({ getThread: () => { throw new FlintError("permission", "Agents can't do this."); } });
    const r = await exec(["read", "1", "--json"], f);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err)).toEqual({ ok: false, error: { code: "permission", message: "Agents can't do this." } });
    const g = fakeClient({ getThread: () => { throw new Error("boom"); } });
    expect((await exec(["read", "1"], g)).err).toBe("Something went wrong. Try again.\n");
  });
  it("usage errors exit 64 and honor --json", async () => {
    const plain = await exec(["bogus"], fakeClient());
    expect(plain.code).toBe(64);
    expect(plain.err).toMatch(/unknown command/);
    const json = await exec(["list", "--nope", "--json"], fakeClient());
    expect(json.code).toBe(64);
    expect(JSON.parse(json.err)).toMatchObject({ ok: false, error: { code: "usage" } });
    expect(json.err.trim().split("\n")).toHaveLength(1);
  });
  it("prints help with examples and exits 0", async () => {
    const h = await exec(["help", "send"], fakeClient());
    expect(h.code).toBe(0);
    expect(h.out).toContain("Examples:");
    expect((await exec(["--help"], fakeClient())).out).toContain("Usage: flint");
  });
  it("prints the agent guide", async () => {
    const r = await exec(["help", "agents"], fakeClient());
    expect(r.code).toBe(0);
    expect(r.out).toContain("Exit codes");
    expect((await exec(["agents"], fakeClient())).out).toBe(AGENT_GUIDE);
    expect(readFileSync(join(import.meta.dirname, "../AGENTS.md"), "utf8")).toBe(AGENT_GUIDE);
    expect(readFileSync(join(import.meta.dirname, "../../../docs/AGENTS.md"), "utf8")).toBe(AGENT_GUIDE);
  });
});

describe("management commands", () => {
  it("saves an attachment and prints the path", async () => {
    const f = fakeClient({ saveAttachment: "/Users/me/Downloads/a.pdf" });
    expect((await exec(["attachment", "12"], f)).out).toBe("Saved to /Users/me/Downloads/a.pdf\n");
    expect(f.calls[0]).toEqual({ method: "saveAttachment", params: [12] });
  });
  it("cancels, undoes and unsubscribes", async () => {
    const f = fakeClient({ cancelSend: { id: 9 }, undo: undefined, unsubscribe: { method: "one_click" } });
    expect((await exec(["cancel", "3"], f)).out).toContain("Cancelled send 3. Draft 9 is kept");
    expect((await exec(["undo", "tok"], f)).out).toBe("Undone.\n");
    expect((await exec(["unsubscribe", "70"], f)).out).toContain("one-click");
    expect(f.calls.map((c) => c.method)).toEqual(["cancelSend", "undo", "unsubscribe"]);
    expect(f.calls[2]?.params).toEqual([70]);
  });
  it("blocks, unblocks and lists blocked senders", async () => {
    const f = fakeClient({ listBlocked: [{ pattern: "a@b.co", createdAt: NOW.getTime() }] });
    expect((await exec(["block", "a@b.co"], f)).out).toBe("Blocked a@b.co.\n");
    expect((await exec(["unblock", "a@b.co"], f)).out).toBe("Unblocked a@b.co.\n");
    expect((await exec(["blocked"], f)).out).toMatch(/a@b.co\s+10:00/);
  });
  it("lists folders, drafts, the queue and contacts", async () => {
    const f = fakeClient({
      listAccounts: [{ id: "a1", email: "me@x.co" }],
      listFolders: [{ id: 4, name: "Receipts", role: null, unread: 2 }],
      listDrafts: [{ id: 12, to: [addr("", "a@b.co")], subject: "Hi" }],
      listScheduled: [{ id: 3, draftId: 12, subject: "Hi", to: [addr("", "a@b.co")], sendAt: NOW.getTime(), status: "pending" }],
      suggestContacts: [{ email: "c@x.co", name: "Cindy", score: 1 }],
      deleteDraft: undefined,
    });
    expect((await exec(["folders"], f)).out).toMatch(/4\s+me@x.co\s+Receipts\s+2/);
    expect((await exec(["drafts"], f)).out).toMatch(/12\s+a@b.co\s+Hi/);
    expect((await exec(["queue"], f)).out).toMatch(/3\s+12\s+2026-10-25 10:00\s+pending/);
    expect((await exec(["contacts", "cin", "--limit", "5"], f)).out).toMatch(/c@x.co\s+Cindy/);
    expect(f.calls.at(-1)?.params).toEqual(["cin", 5]);
    expect((await exec(["draft-delete", "12"], f)).out).toBe("Deleted draft 12.\n");
  });
});
