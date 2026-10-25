import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Rig } from "./service-compose-kit";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { waitFor } from "./harness";
import { addrOf, boot } from "./service-compose-kit";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob"] });
afterAll(async () => { await gm?.stop(); });

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe.skipIf(!gm)("wave 4 service behaviour against GreenMail", { timeout: 90_000 }, () => {
  let rig: Rig;
  const svc = () => rig.service;
  beforeAll(async () => { rig = await boot(gm!, { settings: { receipts: { enabled: true, defaultOn: true, endpoint: "https://receipts.test" } } }); });
  afterAll(async () => { await rig?.service.stop(); });

  it("keeps inline images when replying to and forwarding a message", async () => {
    await gm!.deliver({
      to: addrOf("alice"), from: "Pic <pic@remote.example>", subject: "Look at this",
      html: '<p>Our logo: <img src="cid:logo123"></p>', attachments: [{ filename: "logo.png", content: PNG, contentType: "image/png", cid: "logo123" }],
    });
    const thread = await waitFor(async () => (await svc().listThreads({ view: "inbox" })).items.find((t) => t.subject === "Look at this"), "message arrives");
    const detail = await svc().getThread(thread.id);
    const messageId = detail.messages[0]!.id;
    for (const mode of ["reply", "forward"] as const) {
      const draft = await svc().createDraft({ mode, messageId });
      expect(draft.quotedHtml, mode).toContain("data:image/png;base64,");
      expect(draft.quotedHtml, mode).not.toContain("cid:logo123");
    }
  });

  it("explains in the draft why read receipts are unavailable", async () => {
    const draft = await svc().createDraft({ mode: "new", to: [{ name: "", address: addrOf("bob") }], subject: "Receipts?" });
    expect(draft.trackingBlockedReason).toBeNull();
    await svc().updateSettings({ compose: { plainTextOnly: true } });
    expect((await svc().getDraft(draft.id)).trackingBlockedReason).toBe("Receipts off: plain-text mode");
    expect((await svc().updateDraft(draft.id, { subject: "Receipts!" })).trackingBlockedReason).toBe("Receipts off: plain-text mode");
    await svc().updateSettings({ compose: { plainTextOnly: false }, receipts: { enabled: false } });
    expect((await svc().getDraft(draft.id)).trackingBlockedReason).toBe("Receipts off in Settings");
    await svc().updateSettings({ receipts: { enabled: true } });
    await svc().deleteDraft(draft.id);
  });

  it("records an untracked row, with the reason, for a tracked send that went out without receipts", async () => {
    await svc().updateSettings({ compose: { plainTextOnly: true } });
    const draft = await svc().createDraft({ mode: "new", to: [{ name: "Bob", address: addrOf("bob") }], subject: "Plain note" });
    expect(draft.track).toBe(true);
    const queued = await svc().sendDraft(draft.id);
    rig.clock.advance(Math.max(0, queued.sendAt - rig.clock.now()) + 1000);
    await rig.nudge();
    const tracked = await waitFor(async () => (await svc().listTracked({ limit: 20 })).find((t) => t.subject === "Plain note"), "untracked row");
    expect(tracked.summary.status).toBe("untracked");
    expect(tracked.recipients[0]).toMatchObject({ email: addrOf("bob"), status: "untracked", note: "Receipts off: plain-text mode" });
    await svc().updateSettings({ compose: { plainTextOnly: false } });
  });

  it("hands the approval screen the whole draft: Cc, Bcc, body and attachment names", async () => {
    const draft = await svc().createDraft({ mode: "new", to: [{ name: "", address: addrOf("bob") }], subject: "Approve me", html: "<p>Body text</p>" });
    await svc().updateDraft(draft.id, { cc: [{ name: "", address: "cc@remote.example" }], bcc: [{ name: "", address: "bcc@remote.example" }] });
    const got = await svc().getDraft(draft.id);
    expect(got).toMatchObject({ subject: "Approve me", attachments: [] });
    expect(got.cc.map((a) => a.address)).toEqual(["cc@remote.example"]);
    expect(got.bcc.map((a) => a.address)).toEqual(["bcc@remote.example"]);
    expect(got.html).toContain("Body text");
    await svc().deleteDraft(draft.id);
  });
});
