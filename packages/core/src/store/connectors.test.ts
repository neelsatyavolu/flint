import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../db/open";
import type { ConnectorManifest, RuleAction } from "../types";
import { CONNECTOR_DAY, type ConnectorDelivery } from "./connectors";
import { Store } from "./index";
import { makeStore, msg, seedGmail, seedImap, T0 } from "./testkit";

const manifest: ConnectorManifest = {
  flintConnector: 1, id: "example.connector", name: "Example app", description: "Organizes mail",
  homepage: "https://app.example", pairPage: "https://app.example/connect", pairEndpoint: "https://app.example/pair",
  deliverEndpoint: "https://app.example/deliver", revokeEndpoint: "https://app.example/revoke",
  match: { any: [{ field: "subject", op: "contains", value: "confirmation" }], schemaTypes: [] },
  fields: ["messageId", "subject"], historyDays: 30,
};
const stores = new Set<Store>();
const dirs: string[] = [];
afterEach(() => {
  for (const store of stores) store.db.close();
  stores.clear();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
  const store = makeStore();
  stores.add(store);
  const seed = seedImap(store);
  store.insertConnector("connection", "https://app.example/manifest.json", manifest, T0);
  return { store, ...seed };
}
function ledger(store: Store): ConnectorDelivery[] {
  return store.db.prepare("SELECT * FROM connector_deliveries ORDER BY connection_id, message_id").all() as ConnectorDelivery[];
}

describe("connector durable queue", () => {
  it("dedupes reingest and copies by RFC Message-ID separately for each connection", () => {
    const { store, account, inbox, archive } = setup();
    store.insertConnector("second", "https://app.example/manifest.json", manifest, T0);
    const message = msg({ uid: 1, messageId: "<same@example.test>" });
    const [first] = store.ingestMessages(account.id, inbox.id, [message], { now: T0 });
    store.ingestMessages(account.id, inbox.id, [message], { now: T0 + 1 });
    const [copy] = store.ingestMessages(account.id, archive.id, [{ ...message, uid: 2 }], { now: T0 + 2 });
    expect(copy!.messageRowId).not.toBe(first!.messageRowId);
    expect(ledger(store)).toHaveLength(2);
    expect(ledger(store).map((row) => [row.connection_id, row.message_id, row.message_row_id, row.created_at])).toEqual([
      ["connection", "same@example.test", copy!.messageRowId, T0],
      ["second", "same@example.test", copy!.messageRowId, T0],
    ]);
    const delivery = store.dueConnectorDeliveries(T0)[0]!;
    store.finishConnectorDelivery(delivery, "delivered", T0 + 3);
    store.finishConnectorDelivery(delivery, "delivered", T0 + 4);
    store.ingestMessages(account.id, archive.id, [{ ...message, uid: 2 }], { now: T0 + 5 });
    store.backfillConnector("connection", T0 - CONNECTOR_DAY, T0 + 6);
    expect(store.requireConnector("connection")).toMatchObject({ deliveredCount: 1, lastDelivery: T0 + 3 });
    expect(store.dueConnectorDeliveries(T0 + 10).map((row) => row.connection_id)).toEqual(["second"]);
  });

  it("retains the delivered ledger after deleting mail and reopening SQLite", () => {
    const dir = mkdtempSync(join(process.cwd(), ".connector-test-"));
    dirs.push(dir);
    const path = join(dir, "flint.db");
    let store = new Store(openDb(path));
    stores.add(store);
    const { account, inbox } = seedImap(store);
    store.insertConnector("connection", "https://app.example/manifest.json", manifest, T0);
    const message = msg({ uid: 1, messageId: "persist@example.test" });
    store.ingestMessages(account.id, inbox.id, [message], { now: T0 });
    store.finishConnectorDelivery(store.dueConnectorDeliveries(T0)[0]!, "delivered", T0 + 1);
    store.removeUids(inbox.id, [1]);
    expect(ledger(store)[0]).toMatchObject({ state: "delivered", message_row_id: null });
    store.db.close();
    stores.delete(store);
    store = new Store(openDb(path));
    stores.add(store);
    store.ingestMessages(account.id, inbox.id, [{ ...message, uid: 2 }], { now: T0 + 2 });
    expect(store.dueConnectorDeliveries(T0 + 2)).toEqual([]);
    expect(store.requireConnector("connection").deliveredCount).toBe(1);
    expect(ledger(store)).toHaveLength(1);
  });

  it("uses exponential retry delays, caps at one hour and fails at the 24-hour deadline", () => {
    const { store, account, inbox } = setup();
    store.ingestMessages(account.id, inbox.id, [msg({ uid: 1 })], { now: T0 });
    let time = T0;
    for (let attempt = 0; attempt < 13; attempt++) {
      const delivery = store.dueConnectorDeliveries(time)[0]!;
      expect(delivery.attempts).toBe(attempt);
      store.retryConnectorDelivery(delivery, time);
      const delay = Math.min(3_600_000, 5_000 * 2 ** Math.min(attempt, 10));
      expect(store.dueConnectorDeliveries(time + delay - 1)).toEqual([]);
      time += delay;
      expect(store.dueConnectorDeliveries(time)).toHaveLength(1);
    }
    const delivery = store.dueConnectorDeliveries(time)[0]!;
    store.retryConnectorDelivery(delivery, T0 + CONNECTOR_DAY - 1_000);
    expect(ledger(store)[0]!.next_attempt).toBe(T0 + CONNECTOR_DAY);
    expect(store.dueConnectorDeliveries(T0 + CONNECTOR_DAY - 1)).toEqual([]);
    store.retryConnectorDelivery(store.dueConnectorDeliveries(T0 + CONNECTOR_DAY)[0]!, T0 + CONNECTOR_DAY);
    expect(ledger(store)[0]!.state).toBe("failed");
    expect(store.dueConnectorDeliveries(T0 + 2 * CONNECTOR_DAY)).toEqual([]);
  });

  it("starts the retry window at the first attempt after an approval pause", () => {
    const { store, account, inbox } = setup();
    store.ingestMessages(account.id, inbox.id, [msg({ uid: 1 })], { now: T0 });
    store.setConnectorManifest("connection", manifest, true, T0);
    const resumedAt = T0 + 3 * CONNECTOR_DAY;
    store.setConnectorManifest("connection", manifest, false, resumedAt);
    const delivery = store.dueConnectorDeliveries(resumedAt)[0]!;
    expect(delivery.first_attempt).toBeNull();
    store.beginConnectorDelivery(delivery, resumedAt);
    store.retryConnectorDelivery(delivery, resumedAt);
    expect(ledger(store)[0]).toMatchObject({ state: "pending", first_attempt: resumedAt, next_attempt: resumedAt + 5_000 });
    const retry = store.dueConnectorDeliveries(resumedAt + 5_000)[0]!;
    store.beginConnectorDelivery(retry, resumedAt + 5_000);
    expect(retry.first_attempt).toBe(resumedAt);
    store.retryConnectorDelivery(retry, resumedAt + CONNECTOR_DAY);
    expect(ledger(store)[0]!.state).toBe("failed");
  });

  it("pauses pending delivery for approval or stopped connections and deletes queue rows on removal", () => {
    const { store, account, inbox } = setup();
    store.ingestMessages(account.id, inbox.id, [msg({ uid: 1 })], { now: T0 });
    const wider = { ...manifest, fields: [...manifest.fields, "text" as const] };
    store.setConnectorManifest("connection", wider, true, T0 + 1);
    expect(store.requireConnector("connection")).toMatchObject({ status: "needs_approval", manifest, pendingManifest: wider });
    expect(store.dueConnectorDeliveries(T0 + 1)).toEqual([]);
    store.ingestMessages(account.id, inbox.id, [msg({ uid: 2 })], { now: T0 + 2 });
    expect(ledger(store)).toHaveLength(2);
    store.setConnectorManifest("connection", wider, false, T0 + 3);
    expect(store.dueConnectorDeliveries(T0 + 3)).toHaveLength(2);
    expect(store.requireConnector("connection")).toMatchObject({ status: "active", manifest: wider, pendingManifest: null });
    store.stopConnector("connection");
    expect(store.dueConnectorDeliveries(T0 + 4)).toEqual([]);
    expect(store.nextConnectorJob()).toBeNull();
    store.ingestMessages(account.id, inbox.id, [msg({ uid: 3 })], { now: T0 + 4 });
    expect(ledger(store)).toHaveLength(2);
    store.deleteConnector("connection");
    expect(ledger(store)).toEqual([]);
  });

  it("rechecks active manifests daily, including approval-pending connections", () => {
    const { store } = setup();
    expect(store.nextConnectorJob()).toBe(T0 + CONNECTOR_DAY);
    expect(store.connectorsToCheck(T0 + CONNECTOR_DAY - 1)).toEqual([]);
    expect(store.connectorsToCheck(T0 + CONNECTOR_DAY)).toHaveLength(1);
    store.setConnectorManifest("connection", manifest, true, T0 + CONNECTOR_DAY);
    expect(store.connectorsToCheck(T0 + 2 * CONNECTOR_DAY)).toHaveLength(1);
    store.connectorChecked("connection", T0 + 2 * CONNECTOR_DAY);
    expect(store.nextConnectorJob()).toBe(T0 + 3 * CONNECTOR_DAY);
  });
});

describe("connector ingest eligibility and backfill", () => {
  it("honors blocked senders and rule destinations before server actions run, while retaining archive matches", () => {
    const { store, account, inbox, spam, trash, sent, drafts, archive } = setup();
    const cases: { action: RuleAction; eligible: boolean }[] = [
      { action: { type: "trash" }, eligible: false },
      ...[spam, trash, sent, drafts].map((folder) => ({ action: { type: "move" as const, folderPath: folder.path }, eligible: false })),
      { action: { type: "archive" }, eligible: true },
      { action: { type: "move", folderPath: archive.path }, eligible: true },
    ];
    const allowed: number[] = [];
    for (const [index, { action, eligible }] of cases.entries()) {
      const subject = `route-${index}`;
      store.saveRule({ name: subject, enabled: true, accountId: account.id, match: "all", sortOrder: index,
        conditions: [{ field: "subject", op: "equals", value: subject }], actions: [action] });
      const [outcome] = store.ingestMessages(account.id, inbox.id, [msg({ uid: index + 1, subject })], { now: T0 });
      expect(outcome!.ruleActions).toEqual([action]);
      if (eligible) allowed.push(outcome!.messageRowId);
    }
    store.blockSender("blocked@example.test");
    const [blocked] = store.ingestMessages(account.id, inbox.id, [msg({ uid: 100, from: [{ name: "Blocked", address: "blocked@example.test" }] })], { now: T0 });
    expect(blocked!.blocked).toBe(true);
    expect(store.dueConnectorDeliveries(T0).map((row) => row.message_row_id)).toEqual(allowed);
  });

  it("queues committed initial/history ingest even when evaluate is false and reports after commit", async () => {
    const { store, account, archive } = setup();
    const observations: boolean[] = [];
    const unsubscribe = store.onIngest(() => observations.push(store.db.isTransaction));
    const [outcome] = store.ingestMessages(account.id, archive.id, [msg({ uid: 1, date: T0 - 100 * CONNECTOR_DAY })], { now: T0, evaluate: false });
    expect(store.dueConnectorDeliveries(T0)[0]!.message_row_id).toBe(outcome!.messageRowId);
    expect(observations).toEqual([]);
    await Promise.resolve();
    expect(observations).toEqual([false]);
    unsubscribe();
  });

  it("excludes spam, trash, sent, drafts and draft flags", () => {
    const { store, account, inbox, sent, spam, trash, drafts, archive } = setup();
    for (const folder of [sent, spam, trash, drafts]) {
      const [outcome] = store.ingestMessages(account.id, folder.id, [msg({ uid: 1 })], { now: T0 });
      expect(store.connectorEligible(outcome!.messageRowId)).toBe(false);
    }
    store.ingestMessages(account.id, inbox.id, [
      msg({ uid: 1, flags: { seen: false, flagged: false, answered: false, draft: true } }),
    ], { now: T0 });
    const [allowed] = store.ingestMessages(account.id, archive.id, [msg({ uid: 1 })], { now: T0 });
    expect(store.connectorEligible(allowed!.messageRowId)).toBe(true);
    expect(store.dueConnectorDeliveries(T0).map((row) => row.message_row_id)).toEqual([allowed!.messageRowId]);
  });

  it("uses local message IDs when the RFC Message-ID is absent", () => {
    const { store, account, inbox } = setup();
    const messages = [msg({ uid: 1, messageId: null }), msg({ uid: 2, messageId: null })];
    const outcomes = store.ingestMessages(account.id, inbox.id, messages, { now: T0, evaluate: false });
    store.ingestMessages(account.id, inbox.id, messages, { now: T0, evaluate: false });
    store.backfillConnector("connection", T0 - CONNECTOR_DAY, T0);
    expect(ledger(store).map((row) => row.message_id)).toEqual(outcomes.map((row) => String(row.messageRowId)));
    expect(store.connectorHistory(T0 - CONNECTOR_DAY)).toHaveLength(2);
  });

  it("excludes exact and domain-blocked senders from unevaluated ingest, history and backfill", () => {
    const { store, account, inbox, archive } = setup();
    store.blockSender("blocked@example.test");
    store.blockSender("blocked.test");
    const blocked = ["Blocked@Example.Test", "someone@BLOCKED.TEST"];
    for (const folder of [inbox, archive]) {
      for (const [index, address] of blocked.entries()) {
        const [outcome] = store.ingestMessages(account.id, folder.id,
          [msg({ uid: index + 1, from: [{ name: "Sender", address }] })], { now: T0, evaluate: false });
        expect(outcome!.blocked).toBe(false);
        expect(store.connectorEligible(outcome!.messageRowId)).toBe(false);
      }
    }
    store.backfillConnector("connection", T0 - CONNECTOR_DAY, T0);
    expect(ledger(store)).toEqual([]);
    expect(store.connectorHistory(T0 - CONNECTOR_DAY)).toEqual([]);
  });

  it("applies enabled account-scoped trash and spam rules to unevaluated mail using ingest rule fields", () => {
    const { store, account, archive, spam } = setup();
    const other = seedImap(store, "other@example.test");
    const conditions = [
      { field: "body" as const, op: "contains" as const, value: "discard this" },
      { field: "any_recipient" as const, op: "equals" as const, value: "hidden@example.test" },
      { field: "list_id" as const, op: "contains" as const, value: "unwanted.list" },
      { field: "has_attachment" as const, op: "is_true" as const, value: "" },
    ];
    const rule = store.saveRule({ name: "Discard", enabled: true, accountId: account.id, match: "all", sortOrder: 0,
      conditions, actions: [{ type: "trash" }] });
    const message = { htmlBody: "<p>Discard <b>this</b></p>", bcc: [{ name: "Hidden", address: "hidden@example.test" }],
      headers: { "list-id": "unwanted.list" }, hasAttachments: true };
    const [discarded] = store.ingestMessages(account.id, archive.id, [msg({ uid: 1, ...message })], { now: T0, evaluate: false });
    expect(store.connectorEligible(discarded!.messageRowId)).toBe(false);
    const [wrongAccount] = store.ingestMessages(other.account.id, other.inbox.id, [msg({ uid: 1, ...message })], { now: T0, evaluate: false });
    expect(store.connectorEligible(wrongAccount!.messageRowId)).toBe(true);
    store.saveRule({ ...rule, actions: [{ type: "move", folderPath: spam.path }] });
    const [spamMatch] = store.ingestMessages(account.id, archive.id, [msg({ uid: 2, ...message })], { now: T0, evaluate: false });
    expect(store.connectorEligible(spamMatch!.messageRowId)).toBe(false);
    const [nonmatch] = store.ingestMessages(account.id, archive.id, [msg({ uid: 3, ...message, hasAttachments: false })], { now: T0, evaluate: false });
    expect(store.connectorEligible(nonmatch!.messageRowId)).toBe(true);
    store.backfillConnector("connection", T0 - CONNECTOR_DAY, T0);
    expect(ledger(store).map((row) => row.message_row_id).sort()).toEqual([wrongAccount!.messageRowId, nonmatch!.messageRowId].sort());
    store.saveRule({ ...rule, enabled: false });
    expect(store.connectorEligible(discarded!.messageRowId)).toBe(true);
    store.backfillConnector("connection", T0 - CONNECTOR_DAY, T0);
    expect(ledger(store)).toHaveLength(4);
  });

  it("rechecks new blocks, rules and fetched bodies for already queued mail", () => {
    const { store, account, inbox } = setup();
    const [outcome] = store.ingestMessages(account.id, inbox.id, [msg({ uid: 1 })], { now: T0, evaluate: false });
    const id = outcome!.messageRowId;
    expect(store.connectorEligible(id)).toBe(true);
    store.blockSender("carla@example.org");
    expect(store.connectorEligible(id)).toBe(false);
    store.unblockSender("carla@example.org");
    store.saveRule({ name: "Discard", enabled: true, accountId: null, match: "any", sortOrder: 0,
      conditions: [{ field: "body", op: "contains", value: "discard" }], actions: [{ type: "trash" }] });
    expect(store.connectorEligible(id)).toBe(true);
    store.setBody(id, { text: "Please discard", html: null });
    expect(store.connectorEligible(id)).toBe(false);
  });

  it("excludes prohibited Gmail labels even when the source mailbox is All Mail", () => {
    const { store } = setup();
    const gmail = seedGmail(store);
    for (const [index, folder] of [gmail.sent, gmail.spam, gmail.trash, gmail.drafts].entries()) {
      const [outcome] = store.ingestMessages(gmail.account.id, gmail.all.id, [msg({ uid: index + 1, gmMsgid: String(index + 1), gmLabels: [gmail.inbox.path, folder.path] })], { now: T0 });
      expect(store.connectorEligible(outcome!.messageRowId)).toBe(false);
    }
    const [allowed] = store.ingestMessages(gmail.account.id, gmail.all.id, [msg({ uid: 5, gmMsgid: "5", gmLabels: ["Travel"] })], { now: T0 });
    expect(store.dueConnectorDeliveries(T0).map((row) => row.message_row_id)).toEqual([allowed!.messageRowId]);
    store.applyGmailLabels(gmail.all.id, [{ uid: 5, labels: [gmail.spam.path] }]);
    expect(store.connectorEligible(allowed!.messageRowId)).toBe(false);
  });

  it("backfills only the local date window, dedupes copies and reconsiders skipped mail", () => {
    const store = makeStore();
    stores.add(store);
    const { account, inbox, archive, spam } = seedImap(store);
    const cutoff = T0 - manifest.historyDays * CONNECTOR_DAY;
    store.ingestMessages(account.id, inbox.id, [
      msg({ uid: 1, messageId: "old@example.test", date: cutoff - 1 }),
      msg({ uid: 2, messageId: "boundary@example.test", date: cutoff }),
      msg({ uid: 3, messageId: "recent@example.test", date: T0 }),
    ], { now: T0 });
    store.ingestMessages(account.id, archive.id, [msg({ uid: 1, messageId: "recent@example.test", date: T0 })], { now: T0 });
    store.ingestMessages(account.id, spam.id, [msg({ uid: 1, messageId: "spam@example.test", date: T0 })], { now: T0 });
    store.insertConnector("connection", "https://app.example/manifest.json", manifest, T0);
    expect(store.connectorHistory(cutoff)).toHaveLength(2);
    store.backfillConnector("connection", cutoff, T0);
    expect(ledger(store).map((row) => row.message_id)).toEqual(["boundary@example.test", "recent@example.test"]);
    const pending = store.dueConnectorDeliveries(T0);
    store.finishConnectorDelivery(pending[0]!, "delivered", T0 + 1);
    store.finishConnectorDelivery(pending[1]!, "skipped", T0 + 1);
    store.backfillConnector("connection", cutoff, T0 + 2);
    expect(store.dueConnectorDeliveries(T0 + 2)).toHaveLength(1);
    expect(store.dueConnectorDeliveries(T0 + 2)[0]!.message_id).toBe(pending[1]!.message_id);
    expect(ledger(store)).toHaveLength(2);
  });
});
