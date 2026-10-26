import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import type { ImapRunner } from "./runner";
import { fileSentCopy } from "./send";

type Call = { method: string; args: unknown[] };

/** A fake IMAP client: Sent holds `sentUids`, `inboxLabelled` of them also carry the Inbox label. */
function fake(opts: { sentUids: number[]; inboxLabelled?: number[] }) {
  const calls: Call[] = [];
  const client = {
    list: async () => [{ path: "Sent", specialUse: "\\Sent" }, { path: "[Gmail]/Trash", specialUse: "\\Trash" }],
    getMailboxLock: async () => ({ release: () => undefined }),
    search: async () => opts.sentUids,
    fetchAll: async (_r: string, _q: unknown) => opts.sentUids.map((uid) => ({ uid, labels: new Set(opts.inboxLabelled?.includes(uid) ? ["\\Inbox", "\\Sent"] : ["\\Sent"]) })),
    messageMove: async (uids: string, dest: string) => { calls.push({ method: "move", args: [uids, dest] }); return { uidMap: new Map(uids.split(",").map((u) => [Number(u), Number(u) + 1000])) }; },
    messageDelete: async (uids: string) => { calls.push({ method: "delete", args: [uids] }); return true; },
    append: async () => { calls.push({ method: "append", args: [] }); return { uid: 99 }; },
  } as unknown as ImapFlow;
  const runner: ImapRunner = { run: (fn) => fn(client) };
  return { runner, calls };
}

const folders = { provider: "gmail" as const, sentPath: "Sent", trashPath: "[Gmail]/Trash", delaysMs: [0], sleep: async () => undefined };

describe("fileSentCopy on Gmail", () => {
  it("never deletes a copy that is also in the Inbox and does not append a second one", async () => {
    const { runner, calls } = fake({ sentUids: [7], inboxLabelled: [7] });
    const out = await fileSentCopy(runner, folders, "id@x", Buffer.from("m"));
    expect(out.uid).toBe(7);
    expect(calls).toEqual([]);
  });

  it("replaces a server copy that is only in Sent", async () => {
    const { runner, calls } = fake({ sentUids: [7] });
    await fileSentCopy(runner, folders, "id@x", Buffer.from("m"));
    expect(calls.map((c) => c.method)).toContain("move");
    expect(calls.map((c) => c.method)).toContain("append");
  });

  it("keeps Gmail's own copy when nothing was tracked", async () => {
    const { runner, calls } = fake({ sentUids: [7] });
    const out = await fileSentCopy(runner, folders, "id@x", Buffer.from("m"), { serverCopyIsClean: true });
    expect(out.uid).toBe(7);
    expect(calls).toEqual([]);
  });
});

/** A server whose SEARCH HEADER finds nothing (Proton Bridge): the copies are only visible through their envelopes. */
function blindSearch(sent: { uid: number; messageId: string }[]) {
  const calls: Call[] = [];
  let box = [...sent];
  const client = {
    list: async () => [{ path: "Sent", specialUse: "\\Sent" }],
    getMailboxLock: async () => ({ release: () => undefined }),
    get mailbox() { return { exists: box.length }; },
    search: async () => [],
    fetchAll: async (range: string, query: { envelope?: boolean }) => {
      calls.push({ method: "fetch", args: [range] });
      return query.envelope ? box.map((m) => ({ uid: m.uid, envelope: { messageId: `<${m.messageId}>` } })) : [];
    },
    messageDelete: async (uids: string) => {
      calls.push({ method: "delete", args: [uids] });
      const gone = new Set(uids.split(",").map(Number));
      box = box.filter((m) => !gone.has(m.uid));
      return true;
    },
    append: async () => { calls.push({ method: "append", args: [] }); box = [...box, { uid: 99, messageId: "id@x" }]; return { uid: 99 }; },
  } as unknown as ImapFlow;
  const runner: ImapRunner = { run: (fn) => fn(client) };
  return { runner, calls, box: () => box };
}

describe("fileSentCopy when the server's header search finds nothing", () => {
  const imap = { provider: "imap" as const, sentPath: "Sent", trashPath: null, delaysMs: [0], sleep: async () => undefined };

  it("finds the server's copies by envelope Message-ID and leaves exactly one", async () => {
    const { runner, calls, box } = blindSearch([{ uid: 5, messageId: "other@x" }, { uid: 637, messageId: "id@x" }, { uid: 638, messageId: "id@x" }]);
    const out = await fileSentCopy(runner, imap, "id@x", Buffer.from("m"));
    expect(out.uid).toBe(99);
    expect(calls.find((c) => c.method === "delete")?.args).toEqual(["637,638"]);
    expect(box().map((m) => m.uid)).toEqual([5, 99]);
  });

  it("only scans the newest messages, by sequence number", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ uid: i + 1, messageId: `m${i}@x` }));
    const { runner, calls } = blindSearch(many);
    await fileSentCopy(runner, imap, "id@x", Buffer.from("m"));
    expect(calls.find((c) => c.method === "fetch")?.args).toEqual(["451:*"]);
  });
});
