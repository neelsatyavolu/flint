import { describe, expect, it } from "vitest";
import type { Batch } from "./folderSync";
import { newMailEvents } from "./outcomes";
import { makeStore, msg, seedImap, T0 } from "../../store/testkit";
import type { IngestOutcome } from "../../store/types";
import type { RuleAction } from "../../types";

const NOW = T0 + 60_000;

function setup() {
  const store = makeStore();
  const seed = seedImap(store);
  const batchFor = (overrides: Parameters<typeof msg>[0][], role: "inbox" | "sent" = "inbox") => {
    const folder = role === "inbox" ? seed.inbox : seed.sent;
    const items = overrides.map((o) => msg(o));
    const outcomes = store.ingestMessages(seed.account.id, folder.id, items, { evaluate: true });
    return { folder, items, outcomes, structures: new Map(), evaluated: true } satisfies Batch;
  };
  return { store, seed, batchFor };
}

describe("newMailEvents", () => {
  it("emits for unread people mail in the inbox", () => {
    const { store, seed, batchFor } = setup();
    const batch = batchFor([{ uid: 1, subject: "Hello" }]);
    const events = newMailEvents({ store, accountId: seed.account.id }, batch, "INBOX", NOW);
    expect(events).toEqual([expect.objectContaining({ type: "new_mail", subject: "Hello", category: "people", threadId: batch.outcomes[0]!.threadId })]);
  });

  it("skips read, draft, sent and non-inbox mail", () => {
    const { store, seed, batchFor } = setup();
    const read = batchFor([{ uid: 1, flags: { seen: true, flagged: false, answered: false, draft: false } }]);
    expect(newMailEvents({ store, accountId: seed.account.id }, read, "INBOX", NOW)).toEqual([]);
    const draft = batchFor([{ uid: 2, flags: { seen: false, flagged: false, answered: false, draft: true } }]);
    expect(newMailEvents({ store, accountId: seed.account.id }, draft, "INBOX", NOW)).toEqual([]);
    const sent = batchFor([{ uid: 3 }], "sent");
    expect(newMailEvents({ store, accountId: seed.account.id }, sent, "INBOX", NOW)).toEqual([]);
  });

  it("reports newsletters with their category, marks rule requests as forced, and honors notify: false", () => {
    const { store, seed, batchFor } = setup();
    const batch = batchFor([{ uid: 1, headers: { "list-id": "<news.x.org>", "list-unsubscribe": "<https://x.org/u>" }, subject: "News" }]);
    expect(batch.outcomes[0]!.category).toBe("newsletters");
    expect(newMailEvents({ store, accountId: seed.account.id }, batch, "INBOX", NOW)).toEqual([expect.objectContaining({ category: "newsletters" })]);
    expect(newMailEvents({ store, accountId: seed.account.id }, batch, "INBOX", NOW)[0]).not.toHaveProperty("forced");
    const withNotify = { ...batch, outcomes: [{ ...batch.outcomes[0]!, ruleActions: [{ type: "notify", enabled: true }] as RuleAction[] }] };
    expect(newMailEvents({ store, accountId: seed.account.id }, withNotify, "INBOX", NOW)).toEqual([expect.objectContaining({ forced: true })]);
    const people = batchFor([{ uid: 2, subject: "Person" }]);
    const off = { ...people, outcomes: [{ ...people.outcomes[0]!, ruleActions: [{ type: "notify", enabled: false }] as RuleAction[] }] };
    expect(newMailEvents({ store, accountId: seed.account.id }, off, "INBOX", NOW)).toEqual([]);
  });

  it("skips muted threads, rule-muted mail, mail a rule moved away and mail from the user", () => {
    const { store, seed, batchFor } = setup();
    const batch = batchFor([{ uid: 1, subject: "Quiet" }]);
    const o = batch.outcomes[0]!;
    for (const action of [{ type: "mute" }, { type: "archive" }, { type: "trash" }, { type: "move", folderPath: "X" }] as RuleAction[]) {
      expect(newMailEvents({ store, accountId: seed.account.id }, { ...batch, outcomes: [{ ...o, ruleActions: [action] }] }, "INBOX", NOW)).toEqual([]);
    }
    store.setMuted([o.threadId], true);
    expect(newMailEvents({ store, accountId: seed.account.id }, batch, "INBOX", NOW)).toEqual([]);
    const mine = { ...batch, outcomes: [{ ...o, fromMe: true } as IngestOutcome] };
    expect(newMailEvents({ store, accountId: seed.account.id }, { ...mine }, "INBOX", NOW)).toEqual([]);
  });

  it("uses Gmail label paths to decide what is in the inbox", () => {
    const { store, seed, batchFor } = setup();
    const batch = batchFor([{ uid: 1, subject: "Labelled", gmLabels: ["Work"] }, { uid: 2, subject: "Inboxed", gmLabels: ["INBOX"] }]);
    const subjects = newMailEvents({ store, accountId: seed.account.id }, batch, "INBOX", NOW).map((e) => e.type === "new_mail" && e.subject);
    expect(subjects).toEqual(["Inboxed"]);
    expect(newMailEvents({ store, accountId: seed.account.id }, batch, null, NOW)).toEqual([]);
  });

  it("skips old mail found late, spam and trash folders, and carries the snippet", () => {
    const { store, seed, batchFor } = setup();
    const batch = batchFor([{ uid: 1, subject: "Late" }]);
    expect(newMailEvents({ store, accountId: seed.account.id }, batch, "INBOX", NOW + 4 * 24 * 3600 * 1000)).toEqual([]);
    for (const role of ["spam", "trash"] as const) {
      expect(newMailEvents({ store, accountId: seed.account.id }, { ...batch, folder: { ...batch.folder, role } }, "INBOX", NOW)).toEqual([]);
    }
    const withText = batchFor([{ uid: 2, subject: "Body", snippet: "See you at noon" }]);
    expect(newMailEvents({ store, accountId: seed.account.id }, withText, "INBOX", NOW)[0]).toMatchObject({ snippet: "See you at noon" });
  });
});
