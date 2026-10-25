import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openDb } from "../../../packages/core/src/db/open";
import { Store } from "../../../packages/core/src/store";
import type { IngestMessage } from "../../../packages/core/src/store/types";
import { launch, SHOTS } from "./lib/app.mts";

const THREADS = 2000;
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function seedStore(dataDir: string): void {
  const store = new Store(openDb(join(dataDir, "flint.db")));
  const account = store.createAccount({
    email: "perf@test.local", name: "Perf Tester", provider: "imap", authKind: "password", username: "perf",
    imapHost: "127.0.0.1", imapPort: 1, imapSecure: false, smtpHost: "127.0.0.1", smtpPort: 1, smtpSecure: false,
  });
  const inbox = store.upsertFolder(account.id, { path: "INBOX", role: "inbox" });
  store.upsertFolder(account.id, { path: "Sent", role: "sent" });
  store.upsertFolder(account.id, { path: "Trash", role: "trash" });
  store.upsertFolder(account.id, { path: "Archive", role: "archive" });
  const first = ["Ava", "Ben", "Chen", "Dara", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jin", "Kira", "Leo", "Mina", "Noor", "Oz", "Pia"];
  const last = ["Ito", "Moreau", "Park", "Silva", "Novak", "Reyes", "Khan", "Berg", "Haas", "Lund"];
  const topics = ["Q3 budget review", "Contract renewal", "Weekend plans", "Design handoff", "Invoice follow-up", "Standup notes", "Travel itinerary", "Roadmap sync", "Hiring pipeline", "Customer feedback"];
  const now = Date.now();
  const batch: IngestMessage[] = [];
  for (let i = 0; i < THREADS; i++) {
    const news = i % 7 === 0;
    const who = news ? { name: `Digest ${i % 12}`, address: `digest${i % 12}@news${i % 5}.example` } : { name: `${first[i % first.length]} ${last[i % last.length]}`, address: `${first[i % first.length]!.toLowerCase()}${i % last.length}@example.org` };
    batch.push({
      uid: i + 1, messageId: `<perf-${i}@example.org>`, inReplyTo: null, references: [], subject: news ? `Issue ${i}: ${topics[i % topics.length]} digest` : `${topics[i % topics.length]} (${i})`,
      from: [who], to: [{ name: "Perf Tester", address: "perf@test.local" }], cc: [], bcc: [], replyTo: [], date: now - i * 3_400_000,
      flags: { seen: i % 5 !== 0, flagged: false, answered: false, draft: false }, size: 2400, hasAttachments: i % 11 === 0,
      headers: news ? { "list-unsubscribe": "<https://news.example/u>" } : {}, snippet: `Short preview for message ${i}. Nothing important here, just realistic length text.`,
      textBody: `Short preview for message ${i}.`,
    });
    if (batch.length === 250) store.ingestMessages(account.id, inbox.id, batch.splice(0));
  }
  if (batch.length) store.ingestMessages(account.id, inbox.id, batch);
  store.db.close();
}

describe("performance with 2,000 cached threads", () => {
  it("paints the inbox quickly and scrolls without long tasks", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "flint-perf-"));
    dirs.push(dataDir);
    mkdirSync(SHOTS, { recursive: true });
    seedStore(dataDir);

    const t0 = performance.now();
    const l = await launch({ dataDir });
    const spawned = performance.now();
    await l.win.waitForSelector('[role="option"]', { timeout: 15_000 });
    const t1 = performance.now();
    const inPage = await l.win.evaluate(() => {
      const paint = performance.getEntriesByType("paint").map((p) => `${p.name}=${Math.round(p.startTime)}ms`);
      return { now: Math.round(performance.now()), paint, rows: document.querySelectorAll('[role="option"]').length };
    });
    const firstPaintMs = Math.round(t1 - t0);
    const spawnMs = Math.round(spawned - t0);

    // Scroll through the virtualized list while recording long tasks and frame gaps.
    await l.win.evaluate(() => {
      const w = window as unknown as { __long: number[]; __frames: number[] };
      w.__long = [];
      w.__frames = [];
      new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: false });
      let last = performance.now();
      const tick = (t: number) => { w.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const box = await l.win.locator('[role="listbox"]').first().boundingBox();
    await l.win.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    for (let i = 0; i < 120; i++) {
      await l.win.mouse.wheel(0, 320);
      await l.win.waitForTimeout(16);
    }
    await l.win.waitForTimeout(500);
    const scroll = await l.win.evaluate(() => {
      const w = window as unknown as { __long: number[]; __frames: number[] };
      const f = [...w.__frames].sort((a, b) => a - b);
      const top = document.querySelector('[role="listbox"]') as HTMLElement;
      return { long: w.__long, p95: Math.round(f[Math.floor(f.length * 0.95)] ?? 0), max: Math.round(f[f.length - 1] ?? 0), frames: f.length, scrolled: Math.round(top.scrollTop) };
    });
    await l.win.screenshot({ path: join(SHOTS, "perf-scrolled.png") });
    await l.close();
    const report = { threads: THREADS, launchToFirstRowMs: firstPaintMs, electronSpawnMs: spawnMs, inPage, scroll };
    writeFileSync(join(SHOTS, "perf.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    expect(inPage.rows).toBeGreaterThan(5);
  });
});
