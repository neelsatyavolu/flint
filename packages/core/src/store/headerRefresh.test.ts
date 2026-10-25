import { describe, expect, it } from "vitest";
import { DAY, T0, makeStore, msg, person, seedGmail, seedImap } from "./testkit";

describe("header refresh targets", () => {
  it("lists recent received inbox mail by UID folder and skips rule-set categories", () => {
    const store = makeStore();
    const { account, inbox, archive } = seedImap(store);
    store.ingestMessages(account.id, inbox.id, [
      msg({ uid: 1, date: T0 }),
      msg({ uid: 2, date: T0 - 200 * DAY }),
      msg({ uid: 3, date: T0 }),
    ], { evaluate: false });
    store.ingestMessages(account.id, archive.id, [msg({ uid: 9, date: T0 })], { evaluate: false });
    const tid = store.findByFolderUid(inbox.id, 3)!.threadId;
    store.pinCategory([tid], "notifications", "rule");
    expect(store.headerRefreshTargets(account.id, T0 - 90 * DAY)).toEqual([{ folderId: inbox.id, folderPath: "INBOX", uids: [1] }]);
  });

  it("uses the All Mail UID for Gmail inbox mail", () => {
    const store = makeStore();
    const { account, all } = seedGmail(store);
    store.ingestMessages(account.id, all.id, [msg({ uid: 41, gmMsgid: "g1", gmThrid: "t1", gmLabels: ["INBOX"], date: T0 }), msg({ uid: 42, gmMsgid: "g2", gmThrid: "t2", gmLabels: [], date: T0 })], { evaluate: false });
    expect(store.headerRefreshTargets(account.id, T0 - DAY)).toEqual([{ folderId: all.id, folderPath: "[Gmail]/All Mail", uids: [41] }]);
  });

  it("merges fetched headers so re-categorizing sees them", () => {
    const store = makeStore();
    const { account, inbox } = seedImap(store);
    store.ingestMessages(account.id, inbox.id, [msg({ uid: 5, from: [person("UGA Admissions", "apply@uga.edu")], subject: "Your application is complete", headers: { "list-id": "x" } })], { evaluate: false });
    expect(store.mergeHeaders(inbox.id, [{ uid: 5, headers: { "feedback-id": "1:slate:technolutions", "return-path": "<bounce@slate-mx.technolutions.net>" } }, { uid: 6, headers: { a: "b" } }])).toBe(1);
    const row = store.getMessage(store.findByFolderUid(inbox.id, 5)!.id)!;
    expect(row.headers).toMatchObject({ "list-id": "x", "feedback-id": "1:slate:technolutions" });
  });
});
