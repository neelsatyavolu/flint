import { describe, expect, it } from "vitest";
import { METHOD_TIERS } from "@flint/core/api";
import { createMockApi } from "./api";

const NOW = Date.parse("2026-10-25T17:00:00Z");

async function inviteThreads(api: ReturnType<typeof createMockApi>) {
  const page = await api.listThreads({ view: "inbox", limit: 200 });
  return page.items.filter((i) => i.invite);
}

describe("mock invitations", () => {
  it("tiers: reading is read, answering sends, connecting is admin", () => {
    expect(METHOD_TIERS.getInvite).toBe("read");
    expect(METHOD_TIERS.listInvites).toBe("read");
    expect(METHOD_TIERS.inviteConflicts).toBe("read");
    expect(METHOD_TIERS.rsvp).toBe("send");
    expect(METHOD_TIERS.connectGoogleCalendar).toBe("admin");
  });

  it("seeds a weekly Meet invite, an update, a cancellation, a Zoom invite and a reply, with chips on the rows", async () => {
    const api = createMockApi({ now: NOW });
    const rows = await inviteThreads(api);
    const states = rows.map((r) => r.invite!.state).sort();
    expect(states).toEqual(["cancelled", "new", "new", "reply", "updated"]);
    const detail = await api.getThread(rows.find((r) => r.invite!.state === "updated")!.id);
    expect(detail.messages.map((m) => m.invite?.state)).toEqual(["superseded", "updated"]);
    expect(detail.messages[1]!.invite!.changes.map((c) => c.field)).toEqual(["time", "location"]);
  });

  it("rsvp records the answer on the message and refuses cancelled invites", async () => {
    const api = createMockApi({ now: NOW });
    const rows = await inviteThreads(api);
    const fresh = rows.find((r) => r.invite!.title === "Customer interview: Harborline onboarding")!;
    const next = await api.rsvp(fresh.invite!.messageId, "tentative", "Might be late");
    expect(next.yourResponse).toBe("tentative");
    expect(next.yourNote).toBe("Might be late");
    expect((await api.getInvite(fresh.invite!.messageId))?.yourResponse).toBe("tentative");
    const cancelled = rows.find((r) => r.invite!.state === "cancelled")!;
    await expect(api.rsvp(cancelled.invite!.messageId, "accepted")).rejects.toThrow();
  });

  it("conflicts depend on the calendar scope; connecting turns it on", async () => {
    const api = createMockApi({ now: NOW });
    const rows = await inviteThreads(api);
    const weekly = rows.find((r) => r.invite!.uid.startsWith("design-sync"))!;
    expect(await api.inviteConflicts(weekly.invite!.messageId)).toMatchObject({ status: "unknown", reason: "no-scope" });
    await api.connectGoogleCalendar(weekly.accountId);
    expect((await api.getInvite(weekly.invite!.messageId))?.rsvpVia).toBe("google-calendar");
    expect(await api.inviteConflicts(weekly.invite!.messageId)).toMatchObject({ status: "conflict" });
  });

  it("listInvites leaves out cancelled, superseded and reply messages", async () => {
    const api = createMockApi({ now: NOW });
    const list = await api.listInvites();
    expect(list.map((l) => l.invite.title).sort()).toEqual(["Brand review", "Customer interview: Harborline onboarding", "Design sync"]);
    expect(list.map((l) => l.invite.start)).toEqual([...list.map((l) => l.invite.start)].sort((a, b) => a - b));
  });
});
