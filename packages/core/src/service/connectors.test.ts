import { expect, it, vi } from "vitest";
import { Scheduler } from "../scheduler";
import { FakeClock } from "../scheduler/testkit";
import { makeStore, msg, seedImap, T0 } from "../store/testkit";
import type { ConnectorManifest } from "../types";
import type { ServiceContext } from "./context";
import { wireConnectors } from "./connectors";

vi.mock("../connectors/network", () => ({ assertPublicConnectorUrl: vi.fn(async () => undefined) }));

it("keeps scheduled sends responsive while a connector HTTP request is pending, and drains on stop", async () => {
  const store = makeStore();
  const seed = seedImap(store);
  const clock = new FakeClock(T0);
  const sendDraft = vi.fn(async () => undefined);
  const scheduler = new Scheduler({ store, now: clock.nowFn, setTimer: clock.setTimer, clearTimer: clock.clearTimer, jobs: { sendDraft } });
  const manifest: ConnectorManifest = {
    flintConnector: 1, id: "example", name: "Example", description: "Test app", homepage: "https://example.test",
    pairPage: "https://example.test/pair", pairEndpoint: "https://example.test/pair", deliverEndpoint: "https://example.test/deliver", revokeEndpoint: "https://example.test/revoke",
    match: { any: [{ field: "subject", op: "contains", value: "Hello" }], schemaTypes: [] }, fields: ["subject"], historyDays: 10,
  };
  store.insertConnector("connection", "https://example.test/manifest.json", manifest, T0);
  store.ingestMessages(seed.account.id, seed.inbox.id, [msg({ uid: 1, date: T0, textBody: "body" })], { now: T0 });
  let resolveRequest!: (response: Response) => void;
  const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
  const connected = wireConnectors({ store, scheduler, now: clock.nowFn, fetch: fetchImpl,
    platform: { secrets: { get: async () => Buffer.alloc(32, 1).toString("base64url") } }, ensureBodies: async () => undefined,
  } as unknown as ServiceContext);
  try {
    await scheduler.start();
    await scheduler.tick();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const draft = store.createDraft({ accountId: seed.account.id, from: seed.account.email, subject: "Send now" });
    store.createScheduledSend({ draftId: draft.id, sendAt: T0 });
    scheduler.poke();
    await scheduler.tick();
    expect(sendDraft).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resolveRequest(new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(store.requireConnector("connection").deliveredCount).toBe(1));
  } finally {
    scheduler.stop();
    resolveRequest?.(new Response(null, { status: 200 }));
    await connected.stop();
    store.db.close();
  }
});
