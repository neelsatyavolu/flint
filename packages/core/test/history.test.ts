import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseSearch } from "../src/search";
import { hasOlderOnServer } from "../src/service/historyFolders";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { makeRig, type Rig } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["ivan", "judy", "kim"] });
afterAll(async () => { await gm?.stop(); });

const DAY = 24 * 3600 * 1000;
const TOTAL = 300;

function raw(i: number, date: Date, subject: string, from: string): string {
  return [
    `From: ${from}`, "To: recipient@test.local", `Subject: ${subject}`, `Date: ${date.toUTCString()}`,
    `Message-ID: <hist-${i}@remote.example>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", `Body of ${subject}`, "",
  ].join("\r\n");
}

/** 300 messages spread over two years plus one special old one (oldest appended first, so UIDs rise with the date). */
async function seed(rig: Rig): Promise<void> {
  const now = Date.now();
  await rig.server(async (c) => {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const old = new Date(now - 900 * DAY);
      await c.append("INBOX", raw(999, old, "Quarterly budget rollup", "Zed Archive <zed@archive.example>"), ["\\Seen"], old);
      for (let i = TOTAL - 1; i >= 0; i--) {
        const date = new Date(now - (i / TOTAL) * 730 * DAY - 3600_000);
        await c.append("INBOX", raw(i, date, `Message number ${i}`, `Sender ${i % 7} <s${i % 7}@remote.example>`), ["\\Seen"], date);
      }
    } finally {
      lock.release();
    }
  }, rig.account.username);
}

describe.skipIf(!gm)("older mail backfill and server search", () => {
  let g: GreenMail;
  beforeAll(() => { g = gm!; });

  it("syncs a 30 day window, then loadOlder pulls the rest in batches until done", async () => {
    const rig = makeRig(g, "ivan");
    await seed(rig);
    rig.store.updateSettings({ sync: { initialDays: 30, bodiesForRecentDays: 14 } });
    await rig.sync.syncNow();
    const inbox = rig.store.getFolderByRole(rig.account.id, "inbox")!;
    const first = rig.store.listThreads({ view: "inbox", limit: 200 }).items.length;
    expect(first).toBeGreaterThan(5);
    expect(first).toBeLessThan(40);
    expect(hasOlderOnServer(rig.store, { view: "inbox" })).toBe(true);

    let loaded = 0;
    let rounds = 0;
    for (;;) {
      const r = await rig.sync.loadOlder([inbox.id], 100);
      loaded += r.loaded;
      rounds += 1;
      if (!r.hasMore) break;
      expect(rounds).toBeLessThan(10);
    }
    expect(rounds).toBeGreaterThan(2);
    expect(first + loaded).toBe(TOTAL + 1);
    expect(rig.store.listLocalUids(inbox.id)).toHaveLength(TOTAL + 1);
    expect(hasOlderOnServer(rig.store, { view: "inbox" })).toBe(false);
    expect((await rig.sync.loadOlder([inbox.id])).loaded).toBe(0);
    // History is not evaluated as new mail.
    expect(rig.events.some((e) => e.type === "new_mail")).toBe(false);
    await rig.sync.stop();
  });

  it("server search finds an old message by subject and by sender, and does nothing twice", async () => {
    const rig = makeRig(g, "judy");
    await seed(rig);
    rig.store.updateSettings({ sync: { initialDays: 30, bodiesForRecentDays: 14 } });
    await rig.sync.syncNow();
    expect(rig.store.listThreads({ view: "search", search: "rollup" }).items).toHaveLength(0);

    const bySubject = await rig.sync.searchServer(parseSearch("subject:rollup"));
    expect(bySubject).toEqual({ found: 1, added: 1 });
    expect(rig.store.listThreads({ view: "search", search: "subject:rollup" }).items.map((t) => t.subject)).toEqual(["Quarterly budget rollup"]);

    const again = await rig.sync.searchServer(parseSearch("subject:rollup"));
    expect(again).toEqual({ found: 1, added: 0 });

    const byFrom = await rig.sync.searchServer(parseSearch("from:s3@remote.example"));
    expect(byFrom.found).toBe(Math.ceil((TOTAL - 3) / 7));
    expect(byFrom.added).toBeGreaterThan(0);
    expect(rig.store.listThreads({ view: "search", search: "from:s3@remote.example", limit: 200 }).items.length).toBeGreaterThan(byFrom.added - 1);

    expect(await rig.sync.searchServer(parseSearch("has:attachment"))).toEqual({ found: 0, added: 0 });
    await rig.sync.stop();
  });

  it("search results mix local and server mail without duplicates after a later loadOlder", async () => {
    const rig = makeRig(g, "kim");
    await seed(rig);
    rig.store.updateSettings({ sync: { initialDays: 30, bodiesForRecentDays: 14 } });
    await rig.sync.syncNow();
    await rig.sync.searchServer(parseSearch("subject:rollup"));
    const inbox = rig.store.getFolderByRole(rig.account.id, "inbox")!;
    let guard = 0;
    while ((await rig.sync.loadOlder([inbox.id], 150)).hasMore && guard++ < 10);
    const rollups = rig.store.listThreads({ view: "search", search: "subject:rollup" }).items;
    expect(rollups).toHaveLength(1);
    expect(rig.store.listLocalUids(inbox.id)).toHaveLength(TOTAL + 1);
    await rig.sync.stop();
  });
});
