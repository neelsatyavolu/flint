import { describe, expect, it } from "vitest";
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
  attachments: [{ filename: "a.pdf", size: 4096 }], isFromMe: false, ...over,
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
    expect(r.out).toContain("Attachments: a.pdf (4 KB)");
    expect(r.out).toContain("Hello there");
  });
  it("converts html and honors --raw", async () => {
    const f = fakeClient({ getThread: { ...thread, messages: [message({ text: null, html: "<p>Hi <b>you</b></p>" })] } });
    expect((await exec(["read", "7"], f)).out).toContain("Hi you");
    expect((await exec(["read", "7", "--raw"], f)).out).toContain("<p>Hi <b>you</b></p>");
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
  });
  it("snoozes", async () => {
    const f = fakeClient({ snooze: { undoToken: "u" } });
    const r = await exec(["snooze", "5", "tomorrow"], f);
    expect(f.calls[0]).toEqual({ method: "snooze", params: [[5], new Date(2026, 9, 26, 8).getTime()] });
    expect(r.out).toBe("Snoozed thread 5 until 2026-10-26 08:00.\n");
    expect((await exec(["snooze", "5", "yesterday"], f)).code).toBe(1);
  });
  it("moves to a folder, by name or inbox", async () => {
    const f = fakeClient({ getThread: thread, listFolders: [{ id: 4, name: "Receipts", path: "Receipts", role: null }, { id: 5, name: "Archive", path: "A", role: "archive" }], moveToFolder: { undoToken: "u" }, moveToInbox: { undoToken: "u" } });
    expect((await exec(["move", "7", "receipts"], f)).out).toBe("Moved thread 7 to Receipts.\n");
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
  it("watch prints JSON lines", async () => {
    const ev = { type: "toast", level: "info", message: "x" } as const;
    const r = await exec(["watch"], fakeClient({}, [ev, ev]));
    expect(r.out.trim().split("\n").map((l) => JSON.parse(l))).toEqual([ev, ev]);
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
  it("prints help with examples and exits 0; unknown command exits 1", async () => {
    const h = await exec(["help", "send"], fakeClient());
    expect(h.code).toBe(0);
    expect(h.out).toContain("Examples:");
    expect((await exec(["--help"], fakeClient())).out).toContain("Usage: flint");
    expect((await exec(["bogus"], fakeClient())).code).toBe(1);
  });
});
