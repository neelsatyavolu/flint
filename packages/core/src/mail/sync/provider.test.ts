import type { ImapFlow } from "imapflow";
import { describe, expect, it } from "vitest";
import { makeStore, msg, seedImap } from "../../store/testkit";
import { AccountSync } from "./accountSync";

const fakeClient = (capabilities: string[]): ImapFlow =>
  ({ on: () => undefined, connect: async () => undefined, close: () => undefined, usable: true, capabilities: new Set(capabilities) }) as unknown as ImapFlow;

function sync(capabilities: string[], withMail = false) {
  const store = makeStore();
  const s = seedImap(store);
  if (withMail) store.ingestMessages(s.account.id, s.inbox.id, [msg({ uid: 1 })]);
  const accountSync = new AccountSync({ store, accountId: s.account.id, getAuth: async () => ({ user: "u", pass: "p" }), emit: () => undefined, dataDir: "/tmp", createClient: () => fakeClient(capabilities) });
  return { store, id: s.account.id, accountSync };
}

describe("provider detection from X-GM-EXT-1", () => {
  it("marks an IMAP account as Gmail when the server advertises the Gmail extension", async () => {
    const { store, id, accountSync } = sync(["IMAP4REV1", "X-GM-EXT-1"]);
    expect(store.requireAccount(id).provider).toBe("imap");
    await accountSync.run(async () => undefined);
    expect(store.requireAccount(id).provider).toBe("gmail");
  });

  it("leaves other servers alone", async () => {
    const { store, id, accountSync } = sync(["IMAP4REV1", "IDLE"]);
    await accountSync.run(async () => undefined);
    expect(store.requireAccount(id).provider).toBe("imap");
  });

  it("does not switch an account that already holds mail, which would re-ingest it", async () => {
    const { store, id, accountSync } = sync(["X-GM-EXT-1"], true);
    await accountSync.run(async () => undefined);
    expect(store.requireAccount(id).provider).toBe("imap");
  });
});
