import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import { makeStore, msg, seedImap } from "../../store/testkit";
import { AccountSync } from "./accountSync";

describe("fetchBody", () => {
  it("shares one download between callers asking for the same body at once", async () => {
    const store = makeStore();
    const s = seedImap(store);
    const [out] = store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 7 })]);
    let fetches = 0;
    const client = {
      on: () => undefined,
      connect: async () => undefined,
      close: () => undefined,
      usable: true,
      capabilities: new Set<string>(),
      getMailboxLock: async () => ({ release: () => undefined }),
      fetchOne: async () => {
        fetches += 1;
        await new Promise((r) => setTimeout(r, 5));
        return false;
      },
    } as unknown as ImapFlow;
    const sync = new AccountSync({ store, accountId: s.account.id, getAuth: async () => ({ user: "u", pass: "p" }), emit: () => undefined, dataDir: "/tmp", createClient: () => client });

    const results = await Promise.allSettled([sync.fetchBody(out!.messageRowId), sync.fetchBody(out!.messageRowId), sync.fetchBody(out!.messageRowId)]);
    expect(fetches).toBe(1);
    expect(results.every((r) => r.status === "rejected")).toBe(true);

    // Once settled, a later request downloads again.
    await sync.fetchBody(out!.messageRowId).catch(() => undefined);
    expect(fetches).toBe(2);
  });
});
