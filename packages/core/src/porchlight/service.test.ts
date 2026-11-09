import { afterEach, describe, expect, it, vi } from "vitest";
import { DAY, makeStore, msg, person, seedImap, T0 } from "../store/testkit";
import { CARRIER_NAMES } from "../tracking/detect";
import { porchlightCarrier } from "./carriers";
import { PORCHLIGHT_SECRET, PorchlightService } from "./service";

const TOKEN = `plt_${"a".repeat(43)}`;
const TOKEN_ID = "0b6c2f3e-1a2b-4c3d-8e9f-001122334455";
const PKG = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UPS_MAIL = "Your package is on its way.\nTracking Number: 1Z999AA10123456784\nPrivate note: gate code 4417";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

function setup() {
  const store = makeStore();
  const seed = seedImap(store);
  let now = T0;
  let uid = 0;
  const secrets = new Map<string, string>();
  const calls: Call[] = [];
  /** Answers per path; default: claim succeeds, imports create one package per item. */
  let reply: (call: Call) => Response | Promise<Response> = (call) => {
    if (call.url.endsWith("/v1/pairing/claim")) return Response.json({ ok: true, data: { token: TOKEN, tokenId: TOKEN_ID, scopes: ["imports:write"] }, error: null }, { status: 201 });
    if (call.url.endsWith("/v1/imports/flint")) {
      const items = (call.body as { items: { dedupeKey: string }[] }).items;
      return Response.json({ ok: true, data: { results: items.map((it, i) => ({ dedupeKey: it.dedupeKey, packageId: PKG(i + 1), outcome: "created" })) }, error: null });
    }
    return Response.json({ ok: false, data: null, error: { code: "unauthorized" } }, { status: 401 });
  };
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body ? JSON.parse(init.body as string) : null };
    calls.push(call);
    return reply(call);
  });
  const ensureBodies = vi.fn(async (_ids: number[]) => undefined);
  const poke = vi.fn();
  const service = new PorchlightService({
    store, now: () => now, fetch: fetchImpl, ensureBodies, poke, deviceName: () => "Studio",
    platform: { secrets: {
      get: async (k) => secrets.get(k) ?? null,
      set: async (k, v) => { secrets.set(k, v); },
      delete: async (k) => { secrets.delete(k); },
    } },
  });
  cleanups.push(async () => { await service.stop(); store.db.close(); });
  const add = (over: { subject?: string; text?: string | null; date?: number; from?: string; folder?: number } = {}) => {
    uid += 1;
    const body = over.text === undefined ? UPS_MAIL : over.text;
    return store.ingestMessages(seed.account.id, over.folder ?? seed.inbox.id, [msg({
      uid, subject: over.subject ?? "Your order has shipped", date: over.date ?? now,
      from: [person(over.from ?? "Example Outfitters", "orders@outfitters.example")],
      ...(body === null ? {} : { textBody: body, htmlBody: null }),
    })], { now })[0]!;
  };
  const imports = () => calls.filter((c) => c.url.endsWith("/v1/imports/flint"));
  /** Runs the queue until nothing is due right now. */
  const drain = async () => { for (let i = 0; i < 10 && (service.nextDueAt() ?? Infinity) <= now; i++) await service.run(); };
  return {
    store, seed, service, secrets, calls, imports, ensureBodies, poke, add, drain, fetchImpl,
    clock: (value: number) => { now = value; }, reply: (fn: typeof reply) => { reply = fn; },
  };
}

describe("Porchlight pairing", () => {
  it("claims the code with a label, keeps the token only in the secret store, and reports the connection", async () => {
    const t = setup();
    const status = await t.service.api.pairPorchlight(" abcd-efgh ");
    expect(t.calls[0]).toMatchObject({ url: "https://porchlight.xanom.co/v1/pairing/claim", method: "POST", body: { code: "ABCDEFGH", label: "Flint on Studio" } });
    expect(t.calls[0]!.headers.authorization).toBeUndefined();
    expect(JSON.parse(t.secrets.get(PORCHLIGHT_SECRET)!)).toEqual({ token: TOKEN, tokenId: TOKEN_ID });
    expect(status).toEqual({ connection: { label: "Flint on Studio", pairedAt: T0, signedOut: false }, imported: 0, pending: 0, lastImportAt: null });
    const everyRow = JSON.stringify([t.store.db.prepare("SELECT * FROM porchlight_connection").all(), t.store.db.prepare("SELECT * FROM kv_cache").all()]);
    expect(everyRow).not.toContain(TOKEN);
  });

  it("rejects a malformed code without calling Porchlight", async () => {
    const t = setup();
    await expect(t.service.api.pairPorchlight("ABC")).rejects.toThrow("8-character code");
    expect(t.calls).toHaveLength(0);
  });

  it("explains a used or expired code, rate limits and being offline", async () => {
    const t = setup();
    t.reply(() => new Response(null, { status: 401 }));
    await expect(t.service.api.pairPorchlight("ABCDEFGH")).rejects.toThrow("Codes work once and expire after 10 minutes");
    t.reply(() => new Response(null, { status: 429 }));
    await expect(t.service.api.pairPorchlight("ABCDEFGH")).rejects.toThrow("Too many tries");
    t.reply(() => { throw new TypeError("fetch failed"); });
    await expect(t.service.api.pairPorchlight("ABCDEFGH")).rejects.toMatchObject({ code: "network" });
    expect(t.secrets.size).toBe(0);
    expect((await t.service.api.porchlightStatus()).connection).toBeNull();
  });

  it("refuses a claim answer that isn't a Porchlight token", async () => {
    const t = setup();
    t.reply(() => Response.json({ ok: true, data: { token: "nope", tokenId: TOKEN_ID, scopes: [] } }, { status: 201 }));
    await expect(t.service.api.pairPorchlight("ABCDEFGH")).rejects.toThrow();
    expect(t.secrets.size).toBe(0);
  });

  it("backfills the last 30 days of shipping mail once, and nothing older", async () => {
    const t = setup();
    t.add({ subject: "Shipped", date: T0 - 5 * DAY });
    t.add({ subject: "Old shipment", date: T0 - 31 * DAY });
    t.add({ subject: "Lunch?", text: "See you at noon" });
    await t.service.api.pairPorchlight("ABCDEFGH");
    await t.drain();
    expect(t.imports()).toHaveLength(1);
    expect((t.imports()[0]!.body as { items: unknown[] }).items).toHaveLength(1);
    expect(await t.service.api.porchlightStatus()).toMatchObject({ imported: 1, pending: 0, lastImportAt: T0 });
  });

  it("disconnect forgets the token and the queue, and tries to revoke the token", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.add();
    await t.drain();
    expect(await t.service.api.disconnectPorchlight()).toEqual({ revoked: false });
    const revoke = t.calls.at(-1)!;
    expect(revoke).toMatchObject({ url: `https://porchlight.xanom.co/v1/tokens/${TOKEN_ID}`, method: "DELETE" });
    expect(revoke.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(t.secrets.has(PORCHLIGHT_SECRET)).toBe(false);
    expect(await t.service.api.porchlightStatus()).toEqual({ connection: null, imported: 0, pending: 0, lastImportAt: null });
    expect(await t.service.api.listPorchlightPackages()).toEqual([]);
    // New mail after disconnecting is not queued.
    t.add();
    expect(t.service.nextDueAt()).toBeNull();
  });

  it("says revoked when Porchlight accepts the delete", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.reply((call) => call.method === "DELETE" ? Response.json({ ok: true, data: { deleted: true } }) : new Response(null, { status: 500 }));
    expect(await t.service.api.disconnectPorchlight()).toEqual({ revoked: true });
  });
});

describe("Porchlight import", () => {
  it("sends exactly the documented fields for new mail, with the bearer token, and never the body", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    const m = t.add({ subject: "  Your order   has shipped " });
    expect(t.poke).toHaveBeenCalled();
    await t.drain();
    const call = t.imports()[0]!;
    expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(call.headers["content-type"]).toBe("application/json");
    const messageId = t.store.getMessage(m.messageRowId)!.messageId!;
    expect(call.body).toEqual({ items: [{
      trackingNumber: "1Z999AA10123456784", carrier: "ups", merchant: "Example Outfitters", subject: "Your order has shipped",
      messageDate: new Date(t.store.getMessage(m.messageRowId)!.date).toISOString(), dedupeKey: messageId,
    }] });
    expect(JSON.stringify(t.calls)).not.toContain("gate code");
    expect(t.store.listActivity()).toEqual([expect.objectContaining({ agent: "Porchlight", summary: "Sent 1 package to Porchlight", detail: { count: 1 } })]);
    expect(JSON.stringify(t.store.listActivity())).not.toContain("1Z999");
  });

  it("lists imported packages per thread with a link to Porchlight, one per package", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    const m = t.add();
    await t.drain();
    const threadId = t.store.getMessage(m.messageRowId)!.threadId;
    const expected = { packageId: PKG(1), url: `https://porchlight.xanom.co/app/p/${PKG(1)}`, threadId, carrier: "UPS", trackingNumber: "1Z999AA10123456784", importedAt: T0 };
    expect(await t.service.api.listPorchlightPackages({ threadId })).toEqual([expected]);
    expect(await t.service.api.listPorchlightPackages({ threadId: threadId + 100 })).toEqual([]);
    expect(await t.service.api.listPorchlightPackages()).toEqual([expected]);
    await expect(t.service.api.listPorchlightPackages({ threadId: -1 })).rejects.toThrow("threadId");
  });

  it("leaves the carrier out when detection couldn't name one, so Porchlight detects it", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.add({ text: "Tracking number: 9400111206206406260787" });
    await t.drain();
    const item = (t.imports()[0]!.body as { items: Record<string, unknown>[] }).items[0]!;
    expect(item).not.toHaveProperty("carrier");
    expect(item.trackingNumber).toBe("9400111206206406260787");
  });

  it("skips mail with no package, spam, and mail without a body that doesn't look like shipping mail", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.add({ subject: "Dinner", text: "No numbers here" });
    t.add({ folder: t.seed.spam.id });
    t.add({ subject: "Lunch", text: null });
    await t.drain();
    expect(t.imports()).toHaveLength(0);
    expect(t.ensureBodies).not.toHaveBeenCalled();
    expect(t.service.nextDueAt()).toBeNull();
  });

  it("downloads the body of shipping-looking mail before detecting", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    const m = t.add({ subject: "Shipped: socks", text: null });
    t.ensureBodies.mockImplementation(async (ids) => { for (const id of ids) t.store.setBody(id, { text: UPS_MAIL, html: null }); });
    await t.drain();
    expect(t.ensureBodies).toHaveBeenCalledWith([m.messageRowId]);
    expect(t.imports()).toHaveLength(1);
  });

  it("queues while offline and retries with growing backoff", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.reply(() => { throw new TypeError("offline"); });
    t.add();
    await t.service.run();
    const first = t.service.nextDueAt()!;
    expect(first).toBe(T0 + 5_000);
    t.clock(first);
    await t.service.run();
    expect(t.service.nextDueAt()).toBe(first + 10_000);
    expect(await t.service.api.porchlightStatus()).toMatchObject({ pending: 1, imported: 0 });
    // Back online: the next attempt goes through.
    t.reply((call) => Response.json({ ok: true, data: { results: [{ dedupeKey: (call.body as { items: { dedupeKey: string }[] }).items[0]!.dedupeKey, packageId: PKG(7), outcome: "updated" }] } }));
    t.clock(first + 10_000);
    await t.drain();
    expect(await t.service.api.porchlightStatus()).toMatchObject({ pending: 0, imported: 1 });
    expect(t.imports()).toHaveLength(3);
  });

  it("backs off instead of rerunning at once when the secret store fails", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.add();
    const get = vi.spyOn(t.secrets, "get").mockImplementation(() => { throw new Error("keychain locked"); });
    await t.service.run();
    expect(t.service.nextDueAt()).toBe(T0 + 5_000);
    expect(t.imports()).toHaveLength(0);
    get.mockRestore();
    t.clock(T0 + 5_000);
    await t.drain();
    expect(await t.service.api.porchlightStatus()).toMatchObject({ pending: 0, imported: 1 });
  });

  it("honours Retry-After on 429 and gives up after a week", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.reply(() => new Response(null, { status: 429, headers: { "Retry-After": "120" } }));
    t.add();
    await t.service.run();
    expect(t.service.nextDueAt()).toBe(T0 + 120_000);
    t.clock(T0 + 8 * DAY);
    await t.service.run();
    expect(t.service.nextDueAt()).toBeNull();
    expect(await t.service.api.porchlightStatus()).toMatchObject({ pending: 0, imported: 0 });
  });

  it("stops and says so when Porchlight rejects the token, then resumes after pairing again", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    const reply401 = () => new Response(null, { status: 401 });
    t.reply((call) => call.url.endsWith("/imports/flint") ? reply401() : Response.json({ ok: true, data: { token: TOKEN, tokenId: TOKEN_ID, scopes: ["imports:write"] } }, { status: 201 }));
    t.add();
    await t.service.run();
    expect((await t.service.api.porchlightStatus()).connection).toMatchObject({ signedOut: true });
    expect(t.service.nextDueAt()).toBeNull();
    t.reply((call) => call.url.endsWith("/imports/flint")
      ? Response.json({ ok: true, data: { results: [{ dedupeKey: (call.body as { items: { dedupeKey: string }[] }).items[0]!.dedupeKey, packageId: PKG(2), outcome: "created" }] } })
      : Response.json({ ok: true, data: { token: TOKEN, tokenId: TOKEN_ID, scopes: ["imports:write"] } }, { status: 201 }));
    await t.service.api.pairPorchlight("ABCDEFGH");
    await t.drain();
    expect(await t.service.api.porchlightStatus()).toMatchObject({ connection: { signedOut: false }, imported: 1, pending: 0 });
  });

  it("pairing again restarts the week before giving up, for mail queued while signed out", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    const claim = () => Response.json({ ok: true, data: { token: TOKEN, tokenId: TOKEN_ID, scopes: ["imports:write"] } }, { status: 201 });
    t.reply((call) => call.url.endsWith("/imports/flint") ? new Response(null, { status: 401 }) : claim());
    t.add();
    await t.service.run();
    expect((await t.service.api.porchlightStatus()).connection).toMatchObject({ signedOut: true });
    // Eight days later the person pairs again, while Porchlight is briefly down.
    t.clock(T0 + 8 * DAY);
    t.reply((call) => call.url.endsWith("/imports/flint") ? new Response(null, { status: 503 }) : claim());
    await t.service.api.pairPorchlight("ABCDEFGH");
    await t.service.run();
    expect(await t.service.api.porchlightStatus()).toMatchObject({ pending: 1 });
    expect(t.service.nextDueAt()).toBe(T0 + 8 * DAY + 5_000);
  });

  it("records a rejected item without retrying it", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    t.reply((call) => Response.json({ ok: true, data: { results: [{ dedupeKey: (call.body as { items: { dedupeKey: string }[] }).items[0]!.dedupeKey, packageId: null, outcome: "rejected", reason: "bad number" }] } }));
    t.add();
    await t.drain();
    expect(t.imports()).toHaveLength(1);
    expect(t.service.nextDueAt()).toBeNull();
    expect(await t.service.api.listPorchlightPackages()).toEqual([]);
  });

  it("dedupes locally: the same Message-ID in two folders is sent once", async () => {
    const t = setup();
    await t.service.api.pairPorchlight("ABCDEFGH");
    const first = t.add();
    const messageId = t.store.getMessage(first.messageRowId)!.messageId!;
    t.store.ingestMessages(t.seed.account.id, t.seed.archive.id, [msg({ uid: 900, messageId, subject: "Your order has shipped", textBody: UPS_MAIL, htmlBody: null, date: T0 })], { now: T0 });
    await t.drain();
    expect(t.imports()).toHaveLength(1);
    expect((t.imports()[0]!.body as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe("Porchlight carrier ids", () => {
  it("maps every carrier detection can name", () => {
    for (const name of CARRIER_NAMES) expect(porchlightCarrier(name), name).toBeDefined();
    expect(porchlightCarrier("LaserShip")).toBe("ontrac");
    expect(porchlightCarrier("DHL eCommerce")).toBe("dhl_ecommerce");
    expect(porchlightCarrier(null)).toBeUndefined();
  });
});
