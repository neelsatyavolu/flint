import { beforeEach, describe, expect, it } from "vitest";
import { memorySecrets } from "../platform";
import { DEFAULT_SETTINGS } from "../store";
import { makeStore, me, msg, person, seedImap, T0 } from "../store/testkit";
import type { FlintEvent, Settings } from "../types";
import { CREDENTIALS_KEY, ReceiptsClient } from "./client";
import { FakeReceiptsService } from "./fakeService";

const ENDPOINT = "https://r.example";

function setup(over: { enabled?: boolean; endpoint?: string; notifyOnOpen?: boolean } = {}) {
  const store = makeStore();
  const seed = seedImap(store);
  const service = new FakeReceiptsService();
  const secrets = memorySecrets();
  const events: FlintEvent[] = [];
  let now = T0;
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    receipts: { ...DEFAULT_SETTINGS.receipts, enabled: over.enabled ?? true, endpoint: over.endpoint ?? ENDPOINT, notifyOnOpen: over.notifyOnOpen ?? true },
  };
  const client = new ReceiptsClient({ store, secrets, getSettings: () => settings, fetch: service.fetch, now: () => now, emit: (e) => events.push(e) });
  return { store, seed, service, secrets, events, client, tick: (ms: number) => { now += ms; } };
}

const stateOf = (s: ReturnType<typeof setup>, id: number): string | undefined =>
  (s.store.db.prepare("SELECT state FROM tracked_messages WHERE id = ?").get(id) as { state: string } | undefined)?.state;

const carla = person("Carla");
const dan = person("Dan");
const input = (s: ReturnType<typeof setup>, recipients = [carla, dan]) => ({
  accountId: s.seed.account.id, subject: "Plan", messageId: "<out1@example.com>", recipients, selfAddresses: ["me@example.com"],
});

describe("ensureInstall", () => {
  it("installs once and stores credentials", async () => {
    const s = setup();
    const a = await s.client.ensureInstall();
    const b = await s.client.ensureInstall();
    expect(a).toEqual(b);
    expect(s.service.calls.filter((c) => c.path === "/v1/install")).toHaveLength(1);
    expect(JSON.parse((await s.secrets.get(CREDENTIALS_KEY))!)).toMatchObject({ installId: a.installId, endpoint: ENDPOINT });
  });

  it("shares one request between concurrent callers", async () => {
    const s = setup();
    await Promise.all([s.client.ensureInstall(), s.client.ensureInstall()]);
    expect(s.service.installs.size).toBe(1);
  });

  it("installs again when the endpoint changes or stored data is corrupt", async () => {
    const s = setup();
    await s.secrets.set(CREDENTIALS_KEY, "{not json");
    await s.client.ensureInstall();
    await s.secrets.set(CREDENTIALS_KEY, JSON.stringify({ installId: "x", secret: "y", endpoint: "https://other.example" }));
    const creds = await s.client.ensureInstall();
    expect(creds.installId).not.toBe("x");
  });

  it("rejects without an endpoint", async () => {
    const s = setup({ endpoint: "" });
    await expect(s.client.ensureInstall()).rejects.toMatchObject({ code: "invalid" });
    expect(s.client.isConfigured()).toBe(false);
  });
});

describe("prepareTracked", () => {
  it("registers per-recipient tokens and builds pixel urls", async () => {
    const s = setup();
    const out = await s.client.prepareTracked(input(s));
    expect(out.untracked).toEqual([]);
    expect(out.perRecipient.map((r) => r.address.address)).toEqual(["carla@example.org", "dan@example.org"]);
    expect(new Set(out.perRecipient.map((r) => r.token)).size).toBe(2);
    expect(out.perRecipient[0]!.pixelUrl).toBe(`${ENDPOINT}/i/${out.perRecipient[0]!.token}.gif`);
    expect(s.service.tokensFor(out.ref)).toEqual(out.perRecipient.map((r) => r.token));
    const tracked = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com");
    expect(tracked).not.toBeNull();
    expect(stateOf(s, tracked!)).toBe("active");
  });

  it("leaves own addresses and duplicates out", async () => {
    const s = setup();
    const out = await s.client.prepareTracked(input(s, [carla, { name: "", address: "CARLA@example.org" }, me()]));
    expect(out.perRecipient).toHaveLength(1);
    expect(out.untracked.map((a) => a.address)).toEqual(["me@example.com"]);
  });

  it("returns everyone untracked when the service is offline and marks the row unregistered", async () => {
    const s = setup();
    s.service.offline = true;
    const out = await s.client.prepareTracked(input(s));
    expect(out.perRecipient).toEqual([]);
    expect(out.untracked).toHaveLength(2);
    const id = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
    expect(stateOf(s, id)).toBe("unregistered");
  });

  it("falls back to untracked on a server error", async () => {
    const s = setup();
    await s.client.ensureInstall();
    s.service.forceStatus = 500;
    const out = await s.client.prepareTracked(input(s));
    expect(out.perRecipient).toEqual([]);
  });

  it("does nothing when receipts are off", async () => {
    const s = setup({ enabled: false });
    const out = await s.client.prepareTracked(input(s));
    expect(out.perRecipient).toEqual([]);
    expect(out.untracked).toHaveLength(2);
    expect(s.service.calls).toHaveLength(0);
    expect(s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")).toBeNull();
  });

  it("marks unregistered when no endpoint is set but receipts are on", async () => {
    const s = setup({ endpoint: "" });
    const out = await s.client.prepareTracked(input(s));
    expect(out.perRecipient).toEqual([]);
    expect(s.service.calls).toHaveLength(0);
  });

  it("caps tracked recipients at 100", async () => {
    const s = setup();
    const many = Array.from({ length: 103 }, (_, i) => person(`P${i}`));
    const out = await s.client.prepareTracked(input(s, many));
    expect(out.perRecipient).toHaveLength(100);
    expect(out.untracked).toHaveLength(3);
  });
});

describe("pollEvents", () => {
  let s: ReturnType<typeof setup>;
  let prepared: Awaited<ReturnType<ReceiptsClient["prepareTracked"]>>;
  let trackedId: number;
  beforeEach(async () => {
    s = setup();
    prepared = await s.client.prepareTracked(input(s));
    trackedId = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
  });

  const status = (email: string) => s.store.getReceiptDetail(trackedId).recipients.find((r) => r.email === email)!.status;

  it("stores opens, updates status and emits a receipt event", async () => {
    s.service.addEvent(prepared.perRecipient[0]!.token);
    expect(await s.client.pollEvents()).toBe(1);
    expect(status("carla@example.org")).toBe("opened");
    expect(status("dan@example.org")).toBe("sent");
    expect(s.events).toEqual([expect.objectContaining({ type: "receipt", trackedId, email: "carla@example.org", status: "opened" })]);
  });

  it("is idempotent and emits only on status change", async () => {
    const token = prepared.perRecipient[0]!.token;
    s.service.addEvent(token);
    await s.client.pollEvents();
    s.service.addEvent(token);
    expect(await s.client.pollEvents()).toBe(1);
    expect(s.events).toHaveLength(1);
    expect(await s.client.pollEvents()).toBe(0);
  });

  it("does not count prefetch and marks unknowable", async () => {
    s.service.addEvent(prepared.perRecipient[1]!.token, { kind: "prefetch", client: "Apple Mail" });
    expect(await s.client.pollEvents()).toBe(0);
    expect(status("dan@example.org")).toBe("unknowable");
  });

  it("stays quiet when notifyOnOpen is off but still records the open", async () => {
    const q = setup({ notifyOnOpen: false });
    const p = await q.client.prepareTracked(input(q));
    q.service.addEvent(p.perRecipient[0]!.token);
    expect(await q.client.pollEvents()).toBe(1);
    expect(q.events).toEqual([]);
  });

  it("pages through events and persists the cursor", async () => {
    s.service.pageLimit = 1;
    // pageLimit 1 returns short pages, so the loop stops after one; poll repeatedly to drain.
    for (let i = 0; i < 3; i++) s.service.addEvent(prepared.perRecipient[i % 2]!.token);
    let total = 0;
    for (let i = 0; i < 4; i++) total += await s.client.pollEvents();
    expect(total).toBe(3);
    const afters = s.service.calls.filter((c) => c.path.startsWith("/v1/events")).map((c) => new URL(`http://x${c.path}`).searchParams.get("after"));
    expect(afters[0]).toBe("0");
    expect(afters.at(-1)).not.toBe("0");
  });

  it("returns 0 when not configured", async () => {
    const q = setup({ enabled: false });
    expect(await q.client.pollEvents()).toBe(0);
    expect(q.service.calls).toHaveLength(0);
  });

  it("re-installs once on 401 and then retries", async () => {
    await s.client.ensureInstall();
    s.service.installs.clear();
    await expect(s.client.pollEvents()).resolves.toBe(0);
    expect(s.service.installs.size).toBe(1);
  });

  it("surfaces a network failure as FlintError", async () => {
    await s.client.ensureInstall();
    s.service.offline = true;
    await expect(s.client.pollEvents()).rejects.toMatchObject({ code: "network" });
  });
});

describe("markReplied, seenPing, stopTracking", () => {
  it("marks a recipient replied by message id and emits", async () => {
    const s = setup();
    const p = await s.client.prepareTracked(input(s));
    const trackedId = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
    s.tick(60_000);
    const changes = s.client.markReplied({ accountId: s.seed.account.id, messageId: "<out1@example.com>" }, "Carla@Example.org");
    expect(changes).toHaveLength(1);
    expect(s.store.getReceiptDetail(trackedId).recipients.find((r) => r.email === "carla@example.org")!.status).toBe("replied");
    expect(s.events).toEqual([expect.objectContaining({ type: "receipt", status: "replied" })]);
    expect(s.client.markReplied({ accountId: s.seed.account.id, messageId: "out1@example.com" }, "carla@example.org")).toEqual([]);
    expect(s.client.markReplied({ accountId: s.seed.account.id, messageId: "unknown" }, "carla@example.org")).toEqual([]);
    expect(p.perRecipient).toHaveLength(2);
  });

  it("marks replied by thread id", async () => {
    const s = setup();
    await s.client.prepareTracked(input(s));
    const trackedId = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
    const [out] = s.store.ingestMessages(s.seed.account.id, s.seed.sent.id, [
      msg({ uid: 1, messageId: "out1@example.com", from: [me()], to: [carla, dan], date: T0 }),
    ]);
    const threadId = out!.threadId;
    s.tick(1000);
    expect(s.client.markReplied({ threadId }, "dan@example.org")).toHaveLength(1);
    expect(s.client.markReplied({ threadId: 99 }, "dan@example.org")).toEqual([]);
  });

  it("pings seen and reports failure without throwing", async () => {
    const s = setup();
    expect(await s.client.seenPing()).toBe(true);
    expect(s.service.seenPings).toBe(1);
    s.service.offline = true;
    expect(await s.client.seenPing()).toBe(false);
    expect(await setup({ enabled: false }).client.seenPing()).toBe(false);
  });

  it("stopTracking deletes remotely and marks stopped", async () => {
    const s = setup();
    const p = await s.client.prepareTracked(input(s));
    const trackedId = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
    await s.client.stopTracking(trackedId);
    expect(s.service.messages.has(p.ref)).toBe(false);
    expect(stateOf(s, trackedId)).toBe("stopped");
    await expect(s.client.stopTracking(999)).rejects.toMatchObject({ code: "not_found" });
  });

  it("stopTracking tolerates a 404 and skips the call for unregistered rows", async () => {
    const s = setup();
    const p = await s.client.prepareTracked(input(s));
    const trackedId = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
    s.service.messages.delete(p.ref);
    await s.client.stopTracking(trackedId);
    expect(stateOf(s, trackedId)).toBe("stopped");

    const u = setup();
    u.service.offline = true;
    await u.client.prepareTracked(input(u));
    const uid = u.store.findTrackedByMessageId(u.seed.account.id, "out1@example.com")!;
    u.service.calls.length = 0;
    await u.client.stopTracking(uid);
    expect(u.service.calls).toHaveLength(0);
  });

  it("stopTracking reports a network failure and keeps the row active", async () => {
    const s = setup();
    await s.client.prepareTracked(input(s));
    const trackedId = s.store.findTrackedByMessageId(s.seed.account.id, "out1@example.com")!;
    s.service.offline = true;
    await expect(s.client.stopTracking(trackedId)).rejects.toMatchObject({ code: "network" });
    expect(stateOf(s, trackedId)).toBe("active");
  });
});
