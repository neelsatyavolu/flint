import { describe, expect, it } from "vitest";
import { METHOD_TIERS } from "@flint/core/api";
import { calendarCovers } from "@flint/core/types";
import { ME } from "./people";
import { createMockApi } from "./api";

const NOW = Date.parse("2026-10-25T17:00:00Z");

async function orbitInvite(api: ReturnType<typeof createMockApi>) {
  const page = await api.listThreads({ view: "inbox", limit: 200 });
  const row = page.items.find((i) => i.invite?.title === "Brand review")!;
  return row.invite!.messageId;
}

describe("mock calendar accounts", () => {
  it("are admin-tier methods", () => {
    for (const m of ["listCalendarAccounts", "addGoogleCalendarAccount", "addCalDavAccount", "updateCalendarAccount", "removeCalendarAccount"] as const) expect(METHOD_TIERS[m]).toBe("admin");
  });

  it("start with the implicit entry for the Gmail sign-in that has the calendar scope, and the IMAP mailbox has no calendar", async () => {
    const api = createMockApi({ now: NOW });
    const [only, ...rest] = await api.listCalendarAccounts();
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ kind: "google", email: ME.northwind, viaMailAccountId: "acc_northwind" });
    const accounts = await api.listAccounts();
    expect(accounts.filter((a) => !calendarCovers(a, [only!])).map((a) => a.email)).toEqual([ME.orbit, ME.gmail]);
  });

  it("adding a Google calendar for the IMAP address moves its invitations from mail to the calendar, and removing moves them back", async () => {
    const api = createMockApi({ now: NOW });
    const id = await orbitInvite(api);
    expect((await api.getInvite(id))?.rsvpVia).toBe("imip");
    expect(await api.inviteConflicts(id)).toEqual({ status: "unknown", reason: "no-calendar" });
    const added = await api.addGoogleCalendarAccount({ loginHint: ME.orbit });
    expect(added).toMatchObject({ kind: "google", email: ME.orbit.toLowerCase(), addresses: [ME.orbit.toLowerCase()] });
    expect((await api.getInvite(id))?.rsvpVia).toBe("google-calendar");
    expect((await api.inviteConflicts(id)).status).toMatch(/free|conflict/);
    await api.removeCalendarAccount(added.id);
    expect((await api.getInvite(id))?.rsvpVia).toBe("imip");
  });

  it("adds an iCloud calendar by preset, validating the password and the address", async () => {
    const api = createMockApi({ now: NOW });
    await expect(api.addCalDavAccount({ preset: "icloud", username: "me@icloud.com", password: "wrong" })).rejects.toMatchObject({ code: "auth" });
    await expect(api.addCalDavAccount({ username: "me@icloud.com", password: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(api.addCalDavAccount({ url: "http://dav.example.com", username: "me", password: "x" })).rejects.toMatchObject({ code: "invalid" });
    const id = await orbitInvite(api);
    const added = await api.addCalDavAccount({ preset: "icloud", username: "me@icloud.com", password: "abcd-efgh", extraAddresses: [ME.orbit] });
    expect(added).toMatchObject({ kind: "caldav", preset: "icloud", name: "iCloud Calendar", serverUrl: "https://caldav.icloud.com", scheduling: true, status: "ok" });
    expect(added.addresses).toEqual(["me@icloud.com", ME.orbit.toLowerCase()]);
    expect(JSON.stringify(added)).not.toContain("abcd-efgh");
    expect((await api.getInvite(id))?.rsvpVia).toBe("caldav");
  });

  it("edits the extra addresses and refuses to change the implicit entry", async () => {
    const api = createMockApi({ now: NOW });
    const added = await api.addCalDavAccount({ preset: "fastmail", username: "me@fastmail.com", password: "pw" });
    const next = await api.updateCalendarAccount(added.id, { name: "Fastmail", extraAddresses: [ME.orbit.toUpperCase()] });
    expect(next).toMatchObject({ name: "Fastmail", extraAddresses: [ME.orbit.toLowerCase()] });
    await expect(api.updateCalendarAccount(added.id, { extraAddresses: ["nope"] })).rejects.toMatchObject({ code: "invalid" });
    const implicit = (await api.listCalendarAccounts()).find((c) => c.viaMailAccountId)!;
    await expect(api.updateCalendarAccount(implicit.id, { name: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(api.removeCalendarAccount(implicit.id)).rejects.toMatchObject({ code: "invalid" });
  });
});
