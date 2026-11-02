import { afterEach, describe, expect, it, vi } from "vitest";
import { makeStore, msg, seedImap, T0, DAY } from "../store/testkit";
import type { ConnectorManifest } from "../types";
import { deliveryHeaders } from "./signer";
import { manifestHash } from "./manifest";
import { ConnectorService } from "./service";

const manifest = (): ConnectorManifest => ({
  flintConnector: 1, id: "example.app", name: "Example app", description: "Organizes confirmations.",
  homepage: "https://app.example", pairPage: "https://app.example/connect", pairEndpoint: "https://app.example/pair",
  deliverEndpoint: "https://app.example/deliver", revokeEndpoint: "https://app.example/revoke",
  match: { any: [{ field: "subject", op: "contains", value: "booking" }], schemaTypes: [] },
  fields: ["messageId", "subject", "text"], historyDays: 30,
});
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function setup() {
  const store = makeStore();
  const seed = seedImap(store);
  let now = T0;
  let remote = manifest();
  let status = 200;
  let offline = false;
  const secrets = new Map<string, string>();
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    if (!init?.method) return Response.json(remote);
    requests.push({ url: String(url), init });
    if (offline) throw new Error("offline");
    return new Response(null, { status });
  });
  const openExternal = vi.fn(async () => undefined);
  const ensureBodies = vi.fn(async (ids: number[]) => {
    for (const id of ids) store.setBody(id, { text: "private booking body", html: null });
  });
  const poke = vi.fn();
  const checkUrl = vi.fn(async (_url: string) => undefined);
  const service = new ConnectorService({ store, now: () => now, fetch: fetchImpl, ensureBodies, poke, checkUrl,
    platform: { openExternal, secrets: {
      get: async (key) => secrets.get(key) ?? null,
      set: async (key, value) => { secrets.set(key, value); },
      delete: async (key) => { secrets.delete(key); },
    } },
  });
  cleanups.push(async () => { await service.stop(); store.db.close(); });
  const add = (subject = "Your booking", date = now) => store.ingestMessages(seed.account.id, seed.archive.id, [msg({ uid: store.connectorHistory(0).length + 1, subject, date })], { now, evaluate: false })[0]!;
  const pair = async () => {
    const preview = await service.api.previewConnector("https://app.example");
    await service.api.openConnectorPairPage(preview.token);
    return service.api.pairConnector(preview.token, "AB12CD34");
  };
  return { store, seed, service, secrets, requests, ensureBodies, openExternal, fetchImpl, poke, checkUrl, add, pair,
    clock: (value: number) => { now = value; }, remote: (value: ConnectorManifest) => { remote = value; },
    status: (value: number) => { status = value; }, offline: () => { offline = true; },
  };
}

function deliveries(t: ReturnType<typeof setup>) { return t.requests.filter((r) => r.url.endsWith("/deliver")); }

describe("connector service", () => {
  it("pairs the exact preview snapshot, stores only a platform secret, and backfills archived local mail once", async () => {
    const t = setup();
    const m = t.add();
    t.add("Unrelated mail");
    t.add("Old booking", T0 - 31 * DAY);
    const preview = await t.service.api.previewConnector("https://app.example");
    expect(preview).toMatchObject({ count: 1, subjects: ["Your booking"] });
    await expect(t.service.api.pairConnector(preview.token, "AB12CD34")).rejects.toThrow("Open the app");
    await t.service.api.openConnectorPairPage(preview.token);
    expect(t.openExternal).toHaveBeenCalledWith(manifest().pairPage);
    const connection = await t.service.api.pairConnector(preview.token, "AB12CD34");
    const pairing = JSON.parse(t.requests[0]!.init.body as string);
    expect(pairing).toMatchObject({ code: "AB12CD34", connectionId: connection.id, manifestHash: manifestHash(manifest()) });
    expect(Buffer.from(pairing.secret, "base64url")).toHaveLength(32);
    expect(t.secrets.get(`connector:${connection.id}`)).toBe(pairing.secret);
    expect(JSON.stringify(t.store.db.prepare("SELECT * FROM connector_connections").all())).not.toContain(pairing.secret);
    await t.service.run();
    await t.service.run(); // History may encounter the unrelated message before the matching one.
    expect(t.ensureBodies).toHaveBeenCalledWith([m.messageRowId]);
    expect(deliveries(t)).toHaveLength(1);
    const request = deliveries(t)[0]!;
    const body = request.init.body as string;
    expect(JSON.parse(body)).toEqual({ messageId: t.store.getMessage(m.messageRowId)!.messageId, subject: "Your booking", text: "private booking body" });
    expect(request.init.redirect).toBe("error");
    expect(request.init.headers).toEqual({ ...deliveryHeaders(connection.id, pairing.secret, T0 / 1000, body), "Idempotency-Key": `${connection.id}:${t.store.getMessage(m.messageRowId)!.messageId}` });
    expect(t.store.requireConnector(connection.id)).toMatchObject({ deliveredCount: 1, lastDelivery: T0 });
    expect(t.store.listActivity()).toEqual([expect.objectContaining({ summary: "Pushed 1 message", detail: { connectionId: connection.id, count: 1 } })]);
    expect(JSON.stringify(t.store.listActivity())).not.toContain("private booking body");
    await t.service.run();
    expect(deliveries(t)).toHaveLength(1);
    await expect(t.service.api.pairConnector(preview.token, "AB12CD34")).rejects.toThrow("preview expired");
  });

  it("fetches before body matching in preview and refuses an incomplete preview", async () => {
    const t = setup();
    const next = manifest();
    next.match.any = [{ field: "body", op: "contains", value: "booking" }];
    t.remote(next);
    const m = t.add("Confirmation");
    t.ensureBodies.mockImplementationOnce(async () => undefined);
    await expect(t.service.api.previewConnector("https://app.example")).rejects.toThrow("accurate preview");
    const preview = await t.service.api.previewConnector("https://app.example");
    expect(preview.count).toBe(1);
    expect(t.store.getMessage(m.messageRowId)!.bodyLoaded).toBe(true);
    expect(deliveries(t)).toHaveLength(0);
  });

  it("uses the existing body rule fallback for HTML-only mail", async () => {
    const t = setup();
    const next = manifest();
    next.match.any = [{ field: "body", op: "contains", value: "booking" }];
    t.remote(next);
    const m = t.add("Confirmation");
    t.store.setBody(m.messageRowId, { text: null, html: "<p>Your <strong>booking</strong> is confirmed.</p>" });
    const preview = await t.service.api.previewConnector("https://app.example");
    expect(preview.count).toBe(1);
    await t.service.api.openConnectorPairPage(preview.token);
    await t.service.api.pairConnector(preview.token, "AB12CD34");
    await t.service.run();
    expect(deliveries(t)).toHaveLength(1);
  });

  it("queues initial/archive ingestion after pairing and retries unavailable bodies without pushing partial mail", async () => {
    const t = setup();
    await t.pair();
    const m = t.add();
    await Promise.resolve();
    expect(t.poke).toHaveBeenCalled();
    t.ensureBodies.mockImplementationOnce(async () => undefined);
    await t.service.run();
    expect(deliveries(t)).toHaveLength(0);
    expect(t.service.nextDueAt()).toBe(T0 + 5_000);
    t.clock(T0 + 5_000);
    await t.service.run();
    expect(t.ensureBodies).toHaveBeenCalledWith([m.messageRowId]);
    expect(deliveries(t)).toHaveLength(1);
  });

  it.each([401, 410])("stops immediately on HTTP %s without sending later queued messages", async (status) => {
    const t = setup();
    const connection = await t.pair();
    t.add(); t.add("Another booking");
    t.status(status);
    await t.service.run();
    expect(t.store.requireConnector(connection.id).status).toBe("stopped");
    expect(deliveries(t)).toHaveLength(1);
    expect(t.service.nextDueAt()).toBeNull();
  });

  it.each([408, 425, 429, 503, "network"] as const)("retries %s with backoff, gives up at 24h, and does not replay it", async (failure) => {
    const t = setup();
    await t.pair(); t.add();
    if (failure === "network") t.offline(); else t.status(failure);
    await t.service.run();
    expect(t.service.nextDueAt()).toBe(T0 + 5_000);
    t.clock(T0 + 5_000);
    await t.service.run();
    expect(t.service.nextDueAt()).toBe(T0 + 15_000);
    t.clock(T0 + DAY);
    await t.service.run();
    expect(deliveries(t)).toHaveLength(2);
    expect(t.store.db.prepare("SELECT state FROM connector_deliveries").get()).toEqual({ state: "failed" });
  });

  it.each([400, 403, 404, 422])("keeps HTTP %s terminal", async (status) => {
    const t = setup();
    await t.pair(); t.add(); t.status(status);
    await t.service.run();
    expect(t.store.db.prepare("SELECT state FROM connector_deliveries").get()).toEqual({ state: "failed" });
  });

  it.each([["120", 120_000], ["999999", 3_600_000], ["invalid", 5_000], ["-1", 5_000], ["1", 5_000]])("honors Retry-After %s within the backoff bounds", async (retryAfter, delay) => {
    const t = setup();
    await t.pair(); t.add();
    t.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": retryAfter } }));
    await t.service.run();
    expect(t.service.nextDueAt()).toBe(T0 + Number(delay));
  });

  it("paces successful backlog deliveries by one second", async () => {
    const t = setup();
    await t.pair(); t.add(); t.add("Another booking");
    await t.service.run();
    expect(deliveries(t)).toHaveLength(1);
    expect(t.service.nextDueAt()).toBe(T0 + 1_000);
    await t.service.run();
    expect(deliveries(t)).toHaveLength(1);
    t.clock(T0 + 1_000);
    await t.service.run();
    expect(deliveries(t)).toHaveLength(2);
  });

  it("records a successful delivery even when cancelling its body fails", async () => {
    const t = setup();
    const connection = await t.pair(); t.add();
    const response = new Response("unused", { status: 202 });
    vi.spyOn(response.body!, "cancel").mockRejectedValue(new Error("cancel failed"));
    t.fetchImpl.mockResolvedValueOnce(response);
    await t.service.run();
    expect(t.store.requireConnector(connection.id).deliveredCount).toBe(1);
    expect(t.store.db.prepare("SELECT state FROM connector_deliveries").get()).toEqual({ state: "delivered" });
  });

  it.each(["rfc@example.test", null])("sends an idempotency key without requesting the messageId field (%s)", async (messageId) => {
    const t = setup();
    t.remote({ ...manifest(), fields: ["subject"] });
    const connection = await t.pair();
    const [outcome] = t.store.ingestMessages(t.seed.account.id, t.seed.inbox.id, [msg({ uid: 1, messageId, subject: "Your booking", textBody: "body" })], { now: T0, evaluate: false });
    await t.service.run();
    const request = deliveries(t)[0]!;
    expect(request).toBeDefined();
    expect(request.init.headers).toHaveProperty("Idempotency-Key", `${connection.id}:${messageId ?? outcome!.messageRowId}`);
    expect(JSON.parse(request.init.body as string)).toEqual({ subject: "Your booking" });
  });

  it("checks the host before manifest, pair, deliver and revoke requests", async () => {
    const t = setup();
    const connection = await t.pair(); t.add();
    await t.service.run();
    await t.service.api.removeConnector(connection.id);
    expect(t.checkUrl.mock.calls.map(([url]) => url)).toEqual([
      "https://app.example/.well-known/flint-connector.json", manifest().pairEndpoint,
      manifest().deliverEndpoint, manifest().revokeEndpoint,
    ]);
    expect(t.checkUrl.mock.invocationCallOrder.every((order, i) => order < t.fetchImpl.mock.invocationCallOrder[i]!)).toBe(true);
  });

  it("refuses each request when its host check fails", async () => {
    const t = setup();
    t.checkUrl.mockRejectedValueOnce(new Error("private address"));
    await expect(t.service.api.previewConnector("https://app.example")).rejects.toThrow("private address");
    expect(t.fetchImpl).not.toHaveBeenCalled();
    const preview = await t.service.api.previewConnector("https://app.example");
    await t.service.api.openConnectorPairPage(preview.token);
    t.checkUrl.mockRejectedValueOnce(new Error("private address"));
    await expect(t.service.api.pairConnector(preview.token, "ABCD-EFGH")).rejects.toThrow("private address");
    expect(t.requests).toHaveLength(0);
    const connection = await t.service.api.pairConnector(preview.token, "ABCD-EFGH");
    t.add();
    t.checkUrl.mockRejectedValueOnce(new Error("private address"));
    await t.service.run();
    expect(deliveries(t)).toHaveLength(0);
    expect(t.service.nextDueAt()).toBe(T0 + 5_000);
    t.checkUrl.mockRejectedValueOnce(new Error("private address"));
    await t.service.api.removeConnector(connection.id);
    expect(t.requests.map((r) => r.url)).toEqual([manifest().pairEndpoint]);
    expect(t.store.listConnectors()).toEqual([]);
  });

  it("rechecks a newly blocked sender after resolving the delivery host", async () => {
    const t = setup();
    await t.pair(); t.add();
    t.checkUrl.mockImplementationOnce(async () => { t.store.blockSender("carla@example.org"); });
    await t.service.run();
    expect(deliveries(t)).toHaveLength(0);
    expect(t.store.db.prepare("SELECT state FROM connector_deliveries").get()).toEqual({ state: "skipped" });
  });

  it.each(["trash", "spam"])("rechecks %s rules after fetching a body for delivery", async (action) => {
    const t = setup();
    await t.pair(); t.add();
    t.store.saveRule({ name: "Discard", enabled: true, accountId: null, match: "all", sortOrder: 0,
      conditions: [{ field: "body", op: "contains", value: "private booking" }],
      actions: action === "trash" ? [{ type: "trash" }] : [{ type: "move", folderPath: t.seed.spam.path }],
    });
    await t.service.run();
    expect(t.ensureBodies).toHaveBeenCalledTimes(1);
    expect(deliveries(t)).toHaveLength(0);
    expect(t.store.db.prepare("SELECT state FROM connector_deliveries").get()).toEqual({ state: "skipped" });
  });

  it("daily widening pauses pending mail until the exact changed manifest is approved", async () => {
    const t = setup();
    const connection = await t.pair();
    const wider = manifest(); wider.fields.push("html");
    t.remote(wider); t.clock(T0 + DAY); t.add();
    await t.service.run();
    expect(t.store.requireConnector(connection.id)).toMatchObject({ status: "needs_approval", manifest: manifest(), pendingManifest: wider });
    expect(deliveries(t)).toHaveLength(0);
    const preview = await t.service.api.previewConnectorApproval(connection.id);
    expect(preview.count).toBe(1);
    // A connection may wait for consent longer than the delivery retry window.
    t.clock(T0 + 3 * DAY);
    const freshPreview = await t.service.api.previewConnectorApproval(connection.id);
    await t.service.api.approveConnector(connection.id, freshPreview.token);
    await t.service.run();
    expect(JSON.parse(deliveries(t)[0]!.init.body as string)).toHaveProperty("html", null);
    expect(t.store.requireConnector(connection.id).status).toBe("active");
  });

  it("daily narrowing is applied silently and queued mail is re-matched before delivery", async () => {
    const t = setup();
    const connection = await t.pair();
    const narrower = manifest(); narrower.match.any[0]!.value = "hotel booking";
    t.remote(narrower); t.clock(T0 + DAY); t.add(); t.add("Hotel booking");
    await t.service.run();
    await t.service.run();
    expect(t.store.requireConnector(connection.id)).toMatchObject({ status: "active", manifest: narrower, deliveredCount: 1 });
    expect(deliveries(t)).toHaveLength(1);
  });

  it("rechecks exclusions after body loading, and removal sends a signed revoke then deletes secret and queue", async () => {
    const t = setup();
    const connection = await t.pair();
    t.add();
    t.ensureBodies.mockImplementationOnce(async ([id]) => {
      t.store.setBody(id!, { text: "body", html: null });
      t.store.db.prepare("UPDATE messages SET draft = 1 WHERE id = ?").run(id!);
    });
    await t.service.run();
    expect(deliveries(t)).toHaveLength(0);
    const secret = t.secrets.get(`connector:${connection.id}`)!;
    await t.service.api.removeConnector(connection.id);
    const revoke = t.requests.at(-1)!;
    expect(revoke.url).toBe(manifest().revokeEndpoint);
    const body = JSON.stringify({ connectionId: connection.id });
    expect(revoke.init.body).toBe(body);
    expect(revoke.init.headers).toEqual(deliveryHeaders(connection.id, secret, T0 / 1000, body));
    expect(t.secrets.size).toBe(0);
    expect(t.store.listConnectors()).toHaveLength(0);
    expect(t.store.db.prepare("SELECT * FROM connector_deliveries").all()).toHaveLength(0);
  });
});
