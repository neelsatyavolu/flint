import { describe, expect, it } from "vitest";
import { redactParams } from "./redact";
import { summarize, summarizeFailure } from "./summarize";

const a = (address: string) => ({ name: "", address });

describe("summarize", () => {
  it("covers common calls", () => {
    expect(summarize("archive", [[1, 2, 3]], {})).toBe("Archived 3 threads");
    expect(summarize("archive", [[1]], {})).toBe("Archived 1 thread");
    expect(summarize("getThread", [1234], { subject: "Freelancing Cycle 3" })).toBe('Read thread "Freelancing Cycle 3"');
    expect(summarize("getThread", [1234], {})).toBe("Read thread 1234");
    expect(summarize("listThreads", [{ view: "search", search: "invoice" }], {})).toBe('Searched for "invoice"');
    expect(summarize("listThreads", [{ view: "inbox" }], {})).toBe("Listed inbox");
    expect(summarize("createDraft", [{ mode: "new", to: [a("cindy@example.com")] }], {})).toBe("Created draft to cindy@example.com");
    expect(summarize("createDraft", [{ mode: "new" }], { to: [a("x@y.zz")] })).toBe("Created draft to x@y.zz");
    expect(summarize("createDraft", [{ mode: "reply", messageId: 1 }], {})).toBe("Created reply draft");
    expect(summarize("createDraft", [{ mode: "forward", messageId: 1 }], {})).toBe("Created forward draft");
    expect(summarize("markRead", [[1], false], {})).toBe("Marked 1 thread unread");
    expect(summarize("setPinned", [[1, 2], true], {})).toBe("Pinned 2 threads");
    expect(summarize("trash", [[1]], {})).toBe("Moved 1 thread to trash");
    expect(summarize("markSpam", [[1], true], {})).toBe("Marked 1 thread as spam");
    expect(summarize("snooze", [[1], new Date(2026, 9, 26, 8, 0).getTime()], {})).toBe("Snoozed 1 thread until 2026-10-26 08:00");
    expect(summarize("aiRunToText", [{ kind: "ask", question: "who owes me?" }], {})).toBe('Asked "who owes me?"');
    expect(summarize("aiRunToText", [{ kind: "summarize", threadId: 1 }], {})).toBe("Ran AI summarize");
    expect(summarize("listDrafts", [], [])).toBe("Listed drafts");
  });

  it("describes sends", () => {
    const draft = { to: [a("a@b.co"), a("c@d.co"), a("e@f.co"), a("g@h.co")] } as never;
    expect(summarize("sendDraft", [1], { status: "awaiting_approval" }, { draft })).toBe("Queued mail to a@b.co, c@d.co, e@f.co and 1 more for approval");
    expect(summarize("sendDraft", [1], { status: "pending" }, {})).toBe("Queued mail");
    expect(summarize("sendDraft", [1, { sendAt: new Date(2026, 9, 26, 9, 0).getTime() }], { status: "pending" }, { draft: { to: [a("a@b.co")] } as never })).toBe("Queued mail to a@b.co for 2026-10-26 09:00");
  });

  it("falls back to a readable name and describes failures", () => {
    expect(summarize("refreshReceipts", [], null)).toBe("Refreshed read receipts");
    expect(summarize("undo", ["t"], null)).toBe("Undid an action");
    expect(summarizeFailure("getThread", "No such thread.")).toBe("Get thread failed: No such thread.");
  });
});

describe("redactParams", () => {
  it("drops bodies, clips strings and bounds depth", () => {
    const out = redactParams({ html: "x", subject: "s".repeat(300), n: { a: { b: { c: { d: 1 } } } }, list: Array.from({ length: 60 }, (_, i) => i) }) as Record<string, unknown>;
    expect(out.html).toBeUndefined();
    expect((out.subject as string).length).toBe(201);
    expect((out.list as unknown[]).length).toBe(50);
    expect(JSON.stringify(out.n)).toContain("…");
    expect(redactParams(null)).toBeNull();
  });
});
