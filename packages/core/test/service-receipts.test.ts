import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FlintEvent, TrackedMessage } from "../src/types";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { waitFor } from "./harness";
import { addrOf, APPLE_NET, boot, AWS_NET, GMAIL_UA, GOOGLE_NET, header, mailbox, pixelToken, RECEIPTS_ENDPOINT, startWorker, type Rig } from "./service-compose-kit";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob", "carol", "dave", "erin"] });
afterAll(async () => { await gm?.stop(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const person = (name: string) => ({ name: name[0]!.toUpperCase() + name.slice(1), address: addrOf(name) });

describe.skipIf(!gm)("read receipts through the service", { timeout: 90_000 }, () => {
  let rig: Rig;
  let worker: Awaited<ReturnType<typeof startWorker>>;
  let offline = false;
  const svc = () => rig.service;
  const receiptEvents = (): Extract<FlintEvent, { type: "receipt" }>[] => rig.events.filter((e): e is Extract<FlintEvent, { type: "receipt" }> => e.type === "receipt");
  const trackedBy = async (subject: string): Promise<TrackedMessage> => {
    const t = (await svc().listTracked()).find((x) => x.subject === subject);
    if (!t) throw new Error(`No tracked message "${subject}"`);
    return t;
  };
  const statusOf = (t: TrackedMessage, name: string) => t.recipients.find((r) => r.email === addrOf(name))?.status;

  async function sendTracked(subject: string, to: string[], extra: { remindAt?: number } = {}) {
    const draft = await svc().createDraft({ mode: "new", to: to.map(person), subject, html: `<p>${subject}</p>` });
    if (extra.remindAt !== undefined) await svc().updateDraft(draft.id, { remindAt: extra.remindAt });
    await svc().sendDraft(draft.id);
    const copies = await Promise.all(to.map((n) => waitFor(async () => (await mailbox(gm!, n, "INBOX")).find((m) => header(m.source, "Subject") === subject), `${n} copy of ${subject}`, 30_000)));
    return { draft, copies };
  }

  beforeAll(async () => {
    worker = await startWorker();
    const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
      if (offline) throw new TypeError("fetch failed");
      return worker.fetch(input, init);
    }) as typeof fetch;
    rig = await boot(gm!, { fetch: flaky, settings: { receipts: { enabled: true, defaultOn: true, endpoint: RECEIPTS_ENDPOINT, notifyOnOpen: true }, compose: { undoSendSeconds: 0 } } });
  });
  afterAll(async () => { await rig?.service.stop(); });

  it("derives opened, unknowable and sent from classified pixel hits", async () => {
    const { copies } = await sendTracked("Receipt mix", ["bob", "carol", "dave"]);
    const [bob, carol, dave] = copies.map((m) => pixelToken(m!.source)!);
    expect([bob, carol, dave].every(Boolean)).toBe(true);

    await worker.hit(bob!, { ua: GMAIL_UA, ip: "66.249.1.1", cf: GOOGLE_NET, at: 600_000 });
    await worker.hit(carol!, { ua: "Mozilla/5.0 (Macintosh)", ip: "17.58.0.1", cf: APPLE_NET, at: 20_000 });
    await worker.hit(dave!, { ua: "Mozilla/5.0 Chrome/126", ip: "52.1.1.1", cf: AWS_NET, at: 30_000 });

    await svc().refreshReceipts();
    const t = await trackedBy("Receipt mix");
    expect(statusOf(t, "bob")).toBe("opened");
    expect(statusOf(t, "carol")).toBe("unknowable");
    expect(statusOf(t, "dave")).toBe("sent");
    expect(t.summary).toMatchObject({ opened: 1, total: 3, status: "opened" });

    const detail = await svc().getReceipt(t.trackedId);
    const byEmail = (n: string) => detail.events.filter((e) => e.email === addrOf(n));
    expect(byEmail("bob")).toMatchObject([{ kind: "open", client: "Gmail", counted: true }]);
    expect(byEmail("carol")).toMatchObject([{ kind: "prefetch", counted: false }]);
    expect(byEmail("dave")).toMatchObject([{ kind: "scanner", counted: false }]);
    expect(detail.recipients.find((r) => r.email === addrOf("carol"))?.note).toContain("Apple Mail Privacy Protection");

    const statuses = Object.fromEntries(receiptEvents().map((e) => [e.email, e.status]));
    expect(statuses[addrOf("bob")]).toBe("opened");
    expect(statuses[addrOf("carol")]).toBe("unknowable");
    expect(statuses[addrOf("dave")]).toBeUndefined();

    expect((await svc().listTracked({ status: "opened" })).map((x) => x.subject)).toContain("Receipt mix");
    expect(await svc().listTracked({ status: "unopened" })).toEqual([]);
  });

  it("marks a recipient replied when their reply lands in the thread", async () => {
    const t = await trackedBy("Receipt mix");
    const sent = (await mailbox(gm!, "bob", "INBOX")).find((m) => header(m.source, "Subject") === "Receipt mix")!;
    const id = header(sent.source, "Message-ID")!;
    await waitFor(async () => (await svc().listTracked()).find((x) => x.trackedId === t.trackedId)?.threadId, "the tracked message to link to its thread", 30_000);

    await sleep(1300); // message dates have one-second precision; a reply must be later than the send
    await gm!.deliver({ to: addrOf("alice"), from: "Carol <carol@test.local>", subject: "Re: Receipt mix", text: "Got it", inReplyTo: id, references: id });
    await waitFor(async () => statusOf(await trackedBy("Receipt mix"), "carol") === "replied", "carol's reply", 30_000);
    const after = await trackedBy("Receipt mix");
    expect(statusOf(after, "carol")).toBe("replied");
    expect(statusOf(after, "bob")).toBe("opened");
    expect(after.summary.status).toBe("replied");
    expect(receiptEvents().filter((e) => e.status === "replied" && e.email === addrOf("carol"))).toHaveLength(1);
  });

  it("reports an unreachable service with a readable error", async () => {
    offline = true;
    await expect(svc().refreshReceipts()).rejects.toMatchObject({ code: "network", message: "Couldn't reach the receipts service at receipts.test." });
    offline = false;
    await svc().refreshReceipts();
  });

  it("does nothing on refresh while receipts are off, and sends untracked", async () => {
    await svc().updateSettings({ receipts: { enabled: false } });
    await expect(svc().refreshReceipts()).resolves.toBeUndefined();
    const before = (await svc().listTracked()).length;
    const { copies } = await sendTracked("No tracking please", ["bob"]);
    expect(pixelToken(copies[0]!.source)).toBeNull();
    expect((await svc().listTracked()).length).toBe(before);
    await svc().updateSettings({ receipts: { enabled: true } });
  });

  it("stops tracking a message", async () => {
    const t = await trackedBy("Receipt mix");
    await svc().stopTracking(t.trackedId);
    expect(worker.calls.some((c) => c.startsWith("DELETE /v1/messages/"))).toBe(true);
    const after = await trackedBy("Receipt mix");
    expect(statusOf(after, "dave")).toBe("untracked");
    await expect(svc().stopTracking(999999)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc().getReceipt(999999)).rejects.toMatchObject({ code: "not_found" });
  });

  it("fires a reminder only when nobody replied", async () => {
    const remindAt = rig.clock.now() + 3600_000;
    await sendTracked("Follow up silent", ["erin"], { remindAt });
    await sendTracked("Follow up answered", ["bob"], { remindAt });
    for (const s of ["Follow up silent", "Follow up answered"]) {
      await waitFor(async () => (await svc().listThreads({ view: "sent" })).items.some((x) => x.subject === s), `${s} in Sent`, 30_000);
    }
    const bobCopy = (await mailbox(gm!, "bob", "INBOX")).find((m) => header(m.source, "Subject") === "Follow up answered")!;
    const id = header(bobCopy.source, "Message-ID")!;
    await sleep(1300);
    await gm!.deliver({ to: addrOf("alice"), from: "Bob <bob@test.local>", subject: "Re: Follow up answered", text: "Here you go", inReplyTo: id, references: id });
    await waitFor(async () => (await svc().listThreads({ view: "inbox" })).items.some((x) => x.subject === "Follow up answered"), "bob's reply", 30_000);

    expect(rig.notified.filter((n) => n.startsWith("Follow up"))).toEqual([]);
    rig.clock.advance(2 * 3600_000);
    await rig.nudge();
    await waitFor(async () => rig.notified.some((n) => n.includes("No reply from")), "the reminder notification", 15_000);
    expect(rig.notified.filter((n) => n.startsWith("Follow up"))).toEqual(["Follow up: No reply from Erin yet"]);
  });
});
