import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAsAgent } from "../src/agent/context";
import type { FlintEvent } from "../src/types";
import { tryStartGreenMail, type GreenMail } from "./greenmail";
import { addrOf, boot, RECEIPTS_ENDPOINT, type Rig } from "./service-compose-kit";
import { waitFor } from "./harness";

const gm: GreenMail | null = await tryStartGreenMail({ users: ["alice", "bob", "carol"] });
afterAll(async () => { await gm?.stop(); });

const to = (name: string) => [{ name: "", address: addrOf(name) }];
const toasts = (events: FlintEvent[]) => events.flatMap((e) => (e.type === "toast" ? [e.message] : []));

describe.skipIf(!gm)("agents cannot change what the person approved", { timeout: 90_000 }, () => {
  let rig: Rig;
  beforeAll(async () => { rig = await boot(gm!, { settings: { agents: { enabled: true, modify: "allow", send: "ask" } } }); });
  afterAll(async () => { await rig?.service.stop(); });
  const svc = () => rig.service;

  it("rejects agent edits, attachment changes and deletes once a draft is queued, and allows them after cancelling", async () => {
    const d = await runAsAgent("evil", () => svc().createDraft({ mode: "new", to: to("bob"), subject: "Lunch?", html: "<p>Lunch?</p>" }));
    const queued = await runAsAgent("evil", () => svc().sendDraft(d.id));
    expect(queued.status).toBe("awaiting_approval");

    await expect(runAsAgent("evil", () => svc().updateDraft(d.id, { to: to("carol"), bcc: to("bob"), html: "<p>SECRET</p>" })))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(runAsAgent("evil", () => svc().removeAttachment(d.id, "x"))).rejects.toMatchObject({ code: "conflict" });
    await expect(runAsAgent("evil", () => svc().deleteDraft(d.id))).rejects.toMatchObject({ code: "conflict" });
    expect((await svc().getDraft(d.id)).html).toBe("<p>Lunch?</p>");

    // The person can still edit their own queue entry's draft, and the agent can edit again once the send is cancelled.
    await runAsAgent("evil", () => svc().cancelSend(queued.scheduledId));
    const edited = await runAsAgent("evil", () => svc().updateDraft(d.id, { subject: "Changed" }));
    expect(edited.subject).toBe("Changed");
  });

  it("only lets an agent cancel its own sends and delete its own drafts", async () => {
    const mine = await runAsAgent("one", () => svc().createDraft({ mode: "new", to: to("bob"), subject: "Mine" }));
    const queued = await runAsAgent("one", () => svc().sendDraft(mine.id));
    await expect(runAsAgent("two", () => svc().cancelSend(queued.scheduledId))).rejects.toMatchObject({ code: "permission" });
    await expect(runAsAgent("two", () => svc().deleteDraft(mine.id))).rejects.toMatchObject({ code: "permission" });

    const users = await svc().createDraft({ mode: "new", to: to("bob"), subject: "User's" });
    await expect(runAsAgent("one", () => svc().deleteDraft(users.id))).rejects.toMatchObject({ code: "permission" });
    const userSend = await svc().sendDraft(users.id);
    await expect(runAsAgent("one", () => svc().cancelSend(userSend.scheduledId))).rejects.toMatchObject({ code: "permission" });

    await svc().cancelSend(userSend.scheduledId);
    await svc().cancelSend(queued.scheduledId);
    await runAsAgent("one", () => svc().deleteDraft(mine.id));
  });

  it("unsubscribe is a send, so an agent needs send=allow", async () => {
    await expect(runAsAgent("evil", () => svc().unsubscribe(999999))).rejects.toMatchObject({ code: "permission" });
    await svc().updateSettings({ agents: { send: "allow" } });
    await expect(runAsAgent("evil", () => svc().unsubscribe(999999))).rejects.toMatchObject({ code: "not_found" });
    await svc().updateSettings({ agents: { send: "ask" } });
  });
});

describe.skipIf(!gm)("a send that asked for read receipts but went out without them says so", { timeout: 90_000 }, () => {
  const run = async (rig: Rig) => {
    const d = await rig.service.createDraft({ mode: "new", to: to("bob"), subject: "Hello", html: "<p>Hi</p>" });
    expect(d.track).toBe(true);
    const q = await rig.service.sendDraft(d.id);
    rig.clock.advance(Math.max(0, q.sendAt - rig.clock.now()) + 1000);
    await rig.nudge();
    return waitFor(async () => (toasts(rig.events).find((m) => m.includes("without read receipts")) ?? null), "untracked toast", 30_000);
  };

  it("when the receipts service is unreachable", async () => {
    const rig = await boot(gm!, { account: "alice", fetch: (async () => { throw new Error("offline"); }) as typeof fetch, settings: { receipts: { enabled: true, defaultOn: true, endpoint: RECEIPTS_ENDPOINT } } });
    try { expect(await run(rig)).toContain("couldn't be reached"); } finally { await rig.service.stop(); }
  });

  it("in plain text mode", async () => {
    const rig = await boot(gm!, { account: "carol", settings: { compose: { plainTextOnly: true }, receipts: { enabled: true, defaultOn: true, endpoint: RECEIPTS_ENDPOINT } } });
    try { expect(await run(rig)).toContain("plain text"); } finally { await rig.service.stop(); }
  });
});
