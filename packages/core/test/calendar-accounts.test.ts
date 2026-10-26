import { describe, expect, it } from "vitest";
import { GOOGLE_CALENDAR_SCOPE } from "../src/mail/google-oauth";
import { FLINT_METHODS, METHOD_TIERS } from "../src/api";
import { calendarCovers, calendarsFor, type CalendarAccount } from "../src/types";
import { addICloud, googleTokens, NOW, rig } from "./calendar-rig";

const signIn = (over: Record<string, unknown> = {}) => ({
  email: "neel@xanom.co", name: "Neel", accessToken: "GAT", refreshToken: "GRT", expiresAt: NOW + 3_600_000,
  scope: `openid email profile ${GOOGLE_CALENDAR_SCOPE}`, ...over,
});

function withGoogle(over: Record<string, unknown> = {}) {
  const r = rig();
  const calls: Record<string, unknown>[] = [];
  (r.ctx.invites as { googleAuth?: unknown }).googleAuth = async (o: Record<string, unknown>) => { calls.push(o); return signIn(over); };
  return { ...r, calls };
}

/** Every value stored in the calendar_accounts table, as one string. */
const dbDump = (r: ReturnType<typeof rig>): string => JSON.stringify(r.store.db.prepare("SELECT * FROM calendar_accounts").all());

describe("contracts", () => {
  it("manages calendar accounts with the admin tier only, so agents cannot reach them", () => {
    for (const m of ["listCalendarAccounts", "addGoogleCalendarAccount", "addCalDavAccount", "updateCalendarAccount", "removeCalendarAccount"] as const) {
      expect(METHOD_TIERS[m]).toBe("admin");
      expect(FLINT_METHODS).toContain(m);
    }
  });

  it("the migration creates calendar_accounts and mail accounts need no row to count", () => {
    const r = rig();
    expect(r.store.db.prepare("SELECT COUNT(*) AS n FROM calendar_accounts").get()).toEqual({ n: 0 });
  });
});

describe("addGoogleCalendarAccount", () => {
  it("asks for the calendar scope only, with a login hint that does not pull in earlier grants", async () => {
    const r = withGoogle();
    const added = await r.api.addGoogleCalendarAccount({ loginHint: "Neel@Xanom.co" });
    const scopes = String(r.calls[0]!.scopes);
    expect(scopes).toBe(`openid email profile ${GOOGLE_CALENDAR_SCOPE}`);
    expect(scopes).not.toContain("mail.google.com");
    expect(r.calls[0]).toMatchObject({ loginHint: "neel@xanom.co", clientId: "cid" });
    expect(r.calls[0]!.incremental).toBeUndefined();
    expect(added).toMatchObject({ kind: "google", email: "neel@xanom.co", name: "Neel", addresses: ["neel@xanom.co"], status: "ok", viaMailAccountId: null, scheduling: null, serverUrl: null });
  });

  it("keeps the tokens in the secret store and nothing secret in the database", async () => {
    const r = withGoogle();
    const added = await r.api.addGoogleCalendarAccount();
    expect(JSON.parse((await r.secrets.get(`calendar:${added.id}`))!)).toMatchObject({ accessToken: "GAT", refreshToken: "GRT" });
    expect(dbDump(r)).not.toMatch(/GAT|GRT/);
  });

  it("adds optional extra addresses, and signing in again as the same Google account refreshes it instead of adding a row", async () => {
    const r = withGoogle();
    const first = await r.api.addGoogleCalendarAccount({ extraAddresses: [" Neel@Alias.com ", "neel@xanom.co"] });
    expect(first.addresses).toEqual(["neel@xanom.co", "neel@alias.com"]);
    const again = await r.api.addGoogleCalendarAccount();
    expect(again.id).toBe(first.id);
    expect((await r.api.listCalendarAccounts()).filter((c) => c.kind === "google")).toHaveLength(1);
  });

  it("rejects a sign-in without the calendar permission and saves nothing", async () => {
    const r = withGoogle({ scope: "openid email profile" });
    await expect(r.api.addGoogleCalendarAccount()).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("calendar") });
    expect(await r.api.listCalendarAccounts()).toEqual([]);
  });

  it("needs a Google client", async () => {
    const r = rig();
    (r.ctx as { googleClient: () => null }).googleClient = () => null;
    await expect(r.api.addGoogleCalendarAccount()).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("addCalDavAccount", () => {
  it("validates by discovery, saves the discovered details and keeps the password in the secret store only", async () => {
    const r = rig({ flavor: "icloud" });
    const added = await addICloud(r);
    expect(added).toMatchObject({
      kind: "caldav", preset: "icloud", name: "iCloud Calendar", email: "appleid@icloud.com", serverUrl: "https://caldav.icloud.com", username: "appleid@icloud.com",
      calendarName: "Work", scheduling: true, status: "ok", extraAddresses: ["me@example.com"],
    });
    expect(added.addresses).toEqual(["appleid@icloud.com", "me@example.com"]);
    expect(JSON.parse((await r.secrets.get(`calendar:${added.id}`))!)).toEqual({ password: "app-pass" });
    expect(dbDump(r)).not.toContain("app-pass");
    expect(JSON.stringify(added)).not.toContain("app-pass");
  });

  it("supports Fastmail and a custom server", async () => {
    const f = rig({ flavor: "fastmail" });
    expect(await addICloud(f, [])).toMatchObject({ preset: "fastmail", name: "Fastmail Calendar", serverUrl: "https://caldav.fastmail.com/dav/", calendarName: "Work" });
    const c = rig({ flavor: "fastmail" });
    const custom = await c.api.addCalDavAccount({ url: "caldav.fastmail.com/dav/", username: "me@fastmail.com", password: "app-pass", name: "Mine" });
    expect(custom).toMatchObject({ preset: "custom", name: "Mine", serverUrl: "https://caldav.fastmail.com/dav/" });
  });

  it("saves nothing when the password is rejected", async () => {
    const r = rig();
    await expect(r.api.addCalDavAccount({ preset: "icloud", username: r.username, password: "wrong" })).rejects.toMatchObject({ code: "auth" });
    expect(await r.api.listCalendarAccounts()).toEqual([]);
    expect(await r.secrets.get("calendar:anything")).toBeNull();
  });

  it("covers the addresses the server reports for the login", async () => {
    const r = rig({ username: "appleid", addresses: ["Neel@Xanom.co", "neel@icloud.com"] });
    const added = await r.api.addCalDavAccount({ preset: "icloud", username: "appleid", password: "app-pass" });
    expect(added).toMatchObject({ email: "neel@xanom.co", username: "appleid", addresses: ["neel@xanom.co", "neel@icloud.com"] });
  });

  it("asks for an address when the login is not one and the server names none", async () => {
    const r = rig({ username: "appleid", addresses: [] });
    await expect(r.api.addCalDavAccount({ preset: "icloud", username: "appleid", password: "app-pass" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("email address") });
    expect(await r.api.listCalendarAccounts()).toEqual([]);
    const ok = await r.api.addCalDavAccount({ preset: "icloud", username: "appleid", password: "app-pass", extraAddresses: ["neel@xanom.co"] });
    expect(ok.addresses).toEqual(["neel@xanom.co"]);
  });

  it("checks the form before reaching any server", async () => {
    const r = rig();
    await expect(r.api.addCalDavAccount({ preset: "icloud", username: " ", password: "x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(r.api.addCalDavAccount({ username: "u", password: "x" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("iCloud or Fastmail") });
    await expect(r.api.addCalDavAccount({ url: "http://dav.example.com", username: "u", password: "x" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("https") });
    await expect(r.api.addCalDavAccount({ preset: "icloud", username: "u@x.co", password: "x", extraAddresses: ["not an address"] })).rejects.toMatchObject({ code: "invalid" });
    expect(r.fake.log).toHaveLength(0);
  });

  it("adding the same login again updates the account (new password) instead of duplicating it", async () => {
    const r = rig();
    const first = await addICloud(r, ["me@example.com"]);
    const again = await r.api.addCalDavAccount({ preset: "icloud", username: r.username, password: "app-pass", extraAddresses: ["other@example.com"] });
    expect(again.id).toBe(first.id);
    expect(again.extraAddresses).toEqual(["me@example.com", "other@example.com"]);
    expect(await r.api.listCalendarAccounts()).toHaveLength(1);
  });
});

describe("list, update, remove", () => {
  it("lists a Gmail sign-in that has the calendar scope as an implicit entry for its address and aliases", async () => {
    const r = rig();
    const gmail = r.store.createAccount({
      email: "me@gmail.com", name: "Me", provider: "gmail", authKind: "oauth_google", username: "me@gmail.com", aliases: ["Alias@Gmail.com"],
      imapHost: "imap.gmail.com", imapPort: 993, imapSecure: true, smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecure: true,
    });
    expect(await r.api.listCalendarAccounts()).toEqual([]); // no scope yet
    r.store.updateAccount(gmail.id, { calendarScope: true });
    const [implicit] = await r.api.listCalendarAccounts();
    expect(implicit).toMatchObject({ id: `mail:${gmail.id}`, kind: "google", email: "me@gmail.com", addresses: ["me@gmail.com", "alias@gmail.com"], viaMailAccountId: gmail.id, status: "ok" });
    await expect(r.api.updateCalendarAccount(implicit!.id, { name: "x" })).rejects.toMatchObject({ code: "invalid", message: expect.stringContaining("mail account") });
    await expect(r.api.removeCalendarAccount(implicit!.id)).rejects.toMatchObject({ code: "invalid" });
  });

  it("renames, edits the extra addresses (lower case, deduped, validated) and tells the UI", async () => {
    const r = rig();
    const c = await addICloud(r, []);
    r.events.length = 0;
    const next = await r.api.updateCalendarAccount(c.id, { name: "  Personal  ", extraAddresses: ["Neel@Xanom.co", "neel@xanom.co", "appleid@icloud.com", ""] });
    expect(next).toMatchObject({ name: "Personal", extraAddresses: ["neel@xanom.co"], addresses: ["appleid@icloud.com", "neel@xanom.co"] });
    expect(r.events.some((e) => e.type === "mail_changed")).toBe(true);
    await expect(r.api.updateCalendarAccount(c.id, { extraAddresses: ["nope"] })).rejects.toMatchObject({ code: "invalid" });
    await expect(r.api.updateCalendarAccount("cal_missing", { name: "x" })).rejects.toMatchObject({ code: "not_found" });
    expect((await r.api.listCalendarAccounts())[0]!.extraAddresses).toEqual(["neel@xanom.co"]);
  });

  it("removes the row and its saved sign-in", async () => {
    const r = rig();
    const c = await addICloud(r);
    await r.api.removeCalendarAccount(c.id);
    expect(await r.api.listCalendarAccounts()).toEqual([]);
    expect(await r.secrets.get(`calendar:${c.id}`)).toBeNull();
    await expect(r.api.removeCalendarAccount(c.id)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("coverage helpers", () => {
  const cal = (addresses: string[]): CalendarAccount => ({ addresses } as CalendarAccount);
  it("matches mail accounts and addresses case-insensitively, including aliases", () => {
    const calendars = [cal(["neel@xanom.co"]), cal(["x@y.z"])];
    expect(calendarCovers({ email: "Neel@Xanom.co", aliases: [] }, calendars)).toBe(true);
    expect(calendarCovers({ email: "a@b.c", aliases: ["NEEL@xanom.co"] }, calendars)).toBe(true);
    expect(calendarCovers({ email: "a@b.c", aliases: [] }, calendars)).toBe(false);
    expect(calendarsFor(" X@Y.Z ", calendars)).toEqual([calendars[1]]);
  });
});

describe("Google calendar account tokens", () => {
  it("are refreshed when they are about to expire, keeping the granted scope", async () => {
    const r = withGoogle();
    const added = await r.api.addGoogleCalendarAccount();
    await r.secrets.set(`calendar:${added.id}`, googleTokens({ expiresAt: NOW + 1000 }));
    const { calendarAccessToken } = await import("../src/service/calendarAuth");
    const row = r.store.getCalendarAccountRow(added.id)!;
    expect(await calendarAccessToken(r.ctx, row)).toBe("FRESH");
    expect(r.tokenCalls[0]!.get("grant_type")).toBe("refresh_token");
    expect(r.tokenCalls[0]!.get("refresh_token")).toBe("RT");
    expect(JSON.parse((await r.secrets.get(`calendar:${added.id}`))!)).toMatchObject({ accessToken: "FRESH", refreshToken: "RT", scope: GOOGLE_CALENDAR_SCOPE });
  });

  it("keep a fresh token as it is, and mark the account when the saved sign-in is gone", async () => {
    const r = withGoogle();
    const added = await r.api.addGoogleCalendarAccount();
    const { calendarAccessToken } = await import("../src/service/calendarAuth");
    await r.secrets.set(`calendar:${added.id}`, googleTokens());
    expect(await calendarAccessToken(r.ctx, r.store.getCalendarAccountRow(added.id)!)).toBe("AT");
    expect(r.tokenCalls).toHaveLength(0);
    await r.secrets.delete(`calendar:${added.id}`);
    await expect(calendarAccessToken(r.ctx, r.store.getCalendarAccountRow(added.id)!)).rejects.toMatchObject({ code: "auth" });
    expect((await r.api.listCalendarAccounts())[0]).toMatchObject({ status: "needs-signin" });
  });
});
