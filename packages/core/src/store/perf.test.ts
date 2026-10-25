import { describe, expect, it } from "vitest";
import { makeStore, msg, person, seedImap, T0 } from "./testkit";

const THREADS = 5_000;
const PER_THREAD = 4;

function timeMs(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

describe("thread list performance", () => {
  it("serves an inbox page from 20k messages in 5k threads in under 30ms", { timeout: 120_000 }, () => {
    const store = makeStore();
    const s = seedImap(store);
    store.blockSender("blocked@spam.example");
    const batch = [];
    for (let t = 0; t < THREADS; t++) {
      const root = `root${t}@perf`;
      for (let k = 0; k < PER_THREAD; k++) {
        const uid = t * PER_THREAD + k + 1;
        batch.push(msg({
          uid, messageId: k === 0 ? root : `m${uid}@perf`, references: k === 0 ? [] : [root], inReplyTo: k === 0 ? null : root,
          subject: `Thread ${t}`, from: [person(`Sender${t % 300}`, `s${t % 300}@perf.example`)], date: T0 + t * 60_000 + k * 1000,
          flags: { seen: (uid % 3) === 0, flagged: false, answered: false, draft: false }, snippet: `snippet ${uid}`,
          headers: t % 10 === 0 ? { "list-id": "<news.perf>" } : {},
        }));
      }
    }
    for (let i = 0; i < batch.length; i += 1000) store.ingestMessages(s.account.id, s.inbox.id, batch.slice(i, i + 1000), { evaluate: false });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: THREADS * PER_THREAD });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM threads").get()).toEqual({ n: THREADS });

    store.listThreads({ view: "inbox" }); // warm statement cache and page cache
    const first = timeMs(() => { expect(store.listThreads({ view: "inbox", limit: 50 }).items).toHaveLength(50); });
    let cursor = store.listThreads({ view: "inbox", limit: 50 }).nextCursor!;
    const second = timeMs(() => { cursor = store.listThreads({ view: "inbox", limit: 50, cursor }).nextCursor!; });
    const focused = timeMs(() => { expect(store.listThreads({ view: "inbox", focused: true, limit: 50 }).bundles.length).toBe(1); });
    const unread = timeMs(() => { store.listThreads({ view: "inbox", unreadOnly: true, limit: 50 }); });
    const search = timeMs(() => { expect(store.listThreads({ view: "search", search: "thread 42", limit: 50 }).items.length).toBeGreaterThan(0); });
    process.stderr.write(`perf ms: first=${first.toFixed(1)} next=${second.toFixed(1)} focused=${focused.toFixed(1)} unread=${unread.toFixed(1)} search=${search.toFixed(1)}\n`);
    expect(first).toBeLessThan(30);
    expect(second).toBeLessThan(30);
  });
});
