import { describe, expect, it } from "vitest";
import type { AgentActivity } from "@flint/core";
import { describeReads, foldReads } from "./activityModel";

const MIN = 60_000;
let nextId = 1;
function call(at: number, method: string, summary: string, extra: Partial<AgentActivity> = {}): AgentActivity {
  return { id: nextId++, at, agent: "Midterms Bot", method, summary, status: "ok", detail: {}, ...extra };
}

describe("foldReads", () => {
  it("folds a burst of reads by one agent into a single entry", () => {
    const items = [call(10 * MIN, "listDrafts", "Listed drafts"), call(9 * MIN, "listThreads", "Listed spam"), call(8 * MIN, "listAccounts", "Listed accounts")];
    const out = foldReads(items);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "reads", agent: "Midterms Bot" });
    expect(out[0]?.kind === "reads" && out[0].items.map((i) => i.id)).toEqual(items.map((i) => i.id));
  });

  it("keeps changes, failures and lone reads as single calls", () => {
    const items = [
      call(10 * MIN, "listDrafts", "Listed drafts"),
      call(9 * MIN, "archive", "Archived 3 threads"),
      call(8 * MIN, "listThreads", "Listed inbox", { status: "error" }),
      call(7 * MIN, "listAccounts", "Listed accounts"),
    ];
    expect(foldReads(items).map((e) => e.kind)).toEqual(["call", "call", "call", "call"]);
  });

  it("breaks a run when the agent changes or the gap is long", () => {
    const items = [
      call(60 * MIN, "listDrafts", "Listed drafts"),
      call(59 * MIN, "listAccounts", "Listed accounts"),
      call(58 * MIN, "listAccounts", "Listed accounts", { agent: "cli" }),
      call(57 * MIN, "listThreads", "Listed inbox", { agent: "cli" }),
      call(20 * MIN, "listThreads", "Listed inbox", { agent: "cli" }),
      call(19 * MIN, "listThreads", "Listed spam", { agent: "cli" }),
    ];
    const out = foldReads(items);
    expect(out.map((e) => (e.kind === "reads" ? e.items.length : 1))).toEqual([2, 2, 2]);
  });
});

describe("describeReads", () => {
  it("merges Listed calls into one phrase without repeats", () => {
    const items = ["Listed drafts", "Listed spam", "Listed accounts", "Listed spam", "Listed inbox"].map((s, i) => call(i, "listThreads", s));
    expect(describeReads(items)).toBe("Listed drafts, spam, accounts and inbox");
  });

  it("keeps other reads and caps the list", () => {
    const items = [
      call(5, "listThreads", "Listed inbox"),
      call(4, "getThread", 'Read thread "Lunch"'),
      call(3, "listThreads", 'Searched for "invoice"'),
      call(2, "getThread", 'Read thread "Lunch"'),
      call(1, "getSyncStatus", "Checked sync status"),
      call(0, "listFolders", "Listed folders"),
    ];
    expect(describeReads(items)).toBe('Listed inbox and folders, read thread "Lunch", searched for "invoice" and 1 more');
  });
});
