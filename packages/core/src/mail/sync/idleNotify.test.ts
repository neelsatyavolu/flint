import { afterAll, describe, expect, it } from "vitest";
import { tryStartGreenMail } from "../../../test/greenmail";
import { addr, makeRig, waitFor } from "../../../test/harness";

const gm = await tryStartGreenMail({ users: ["nina", "owen"] });
afterAll(async () => { await gm?.stop(); });

describe.skipIf(!gm)("new_mail through IMAP IDLE", () => {
  it("is silent for mail found by the first sync and emits within seconds for mail pushed by IDLE", async () => {
    const rig = makeRig(gm!, "nina", { pollMs: 60_000, idlePollMs: 60_000 });
    await gm!.deliver({ to: addr("nina"), subject: "Already there", text: "old news", from: "Ann <ann@remote.example>" });
    rig.sync.start();
    try {
      await waitFor(() => rig.sync.status().lastSyncAt, "first sync");
      expect(rig.events.some((e) => e.type === "new_mail")).toBe(false);
      await new Promise((r) => setTimeout(r, 1500)); // let the IDLE connection settle
      const started = Date.now();
      await gm!.deliver({ to: addr("nina"), subject: "Pushed", text: "Hello from IDLE", from: "Ann <ann@remote.example>" });
      const ev = await waitFor(() => rig.events.find((e) => e.type === "new_mail"), "new_mail event", 8000);
      expect(Date.now() - started).toBeLessThan(8000);
      expect(ev).toMatchObject({ type: "new_mail", subject: "Pushed", category: "people", accountId: rig.account.id });
      expect(ev.type === "new_mail" && ev.snippet).toContain("Hello from IDLE");
      expect(rig.events.filter((e) => e.type === "new_mail")).toHaveLength(1);
    } finally {
      await rig.sync.stop();
    }
  });

  it("does not alert for mail you sent to yourself", async () => {
    const rig = makeRig(gm!, "owen", { pollMs: 60_000, idlePollMs: 60_000 });
    rig.sync.start();
    try {
      await waitFor(() => rig.sync.status().lastSyncAt, "first sync");
      await new Promise((r) => setTimeout(r, 1500));
      await gm!.deliver({ to: addr("owen"), subject: "Note to self", text: "x", from: `Owen <${addr("owen")}>` });
      await waitFor(() => rig.store.listThreads({ view: "inbox" }).items.find((t) => t.subject === "Note to self"), "thread", 8000);
      expect(rig.events.some((e) => e.type === "new_mail")).toBe(false);
    } finally {
      await rig.sync.stop();
    }
  });
});
