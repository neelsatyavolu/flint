import { describe, expect, it } from "vitest";
import { createMockApi } from "./api";

describe("mock unified inbox", () => {
  it("leaves a hidden account out of all-accounts views and counts, but not its own inbox", async () => {
    const api = createMockApi({ latencyMs: 0 });
    const [first] = await api.listAccounts();
    const all = await api.listThreads({ view: "inbox", limit: 200 });
    const own = all.items.filter((t) => t.accountId === first!.id);
    expect(own.length).toBeGreaterThan(0);
    const countBefore = (await api.getSidebar()).counts.inbox;
    await api.updateAccount(first!.id, { showInUnified: false });
    const after = await api.listThreads({ view: "inbox", limit: 200 });
    expect(after.items.some((t) => t.accountId === first!.id)).toBe(false);
    expect((await api.listThreads({ view: "inbox", accountId: first!.id, limit: 200 })).items.length).toBe(own.length);
    const side = await api.getSidebar();
    expect(side.counts.inbox).toBeLessThanOrEqual(countBefore);
    expect(side.accounts.find((a) => a.account.id === first!.id)!.inboxUnread).toBeGreaterThanOrEqual(0);
    expect((await api.getHome()).unreadPeople.some((t) => t.accountId === first!.id)).toBe(false);
  });
});
