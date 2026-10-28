import { describe, expect, it } from "vitest";
import { buildBundle, BundleError, countPasswordAccounts, parseBundle } from "./bundle";
import { fakeSource } from "./testkit";

const keys = (o: object) => Object.keys(o).sort();

describe("buildBundle", () => {
  it("emits exactly the allowlisted keys, with no token field anywhere", async () => {
    const b = await buildBundle(fakeSource(), { includePasswords: true });
    expect(keys(b)).toEqual(["accounts", "blockedSenders", "createdAt", "device", "rules", "settings", "signatures", "templates", "v"]);
    expect(keys(b.accounts[0]!)).toEqual(["aliases", "authKind", "color", "email", "imap", "name", "password", "provider", "showInUnified", "smtp", "sortOrder", "username"]);
    expect(keys(b.accounts[1]!)).toEqual(["aliases", "authKind", "avatar", "color", "email", "imap", "name", "provider", "showInUnified", "smtp", "sortOrder", "username"]);
    expect(keys(b.accounts[0]!.imap)).toEqual(["host", "port", "secure"]);
    expect(keys(b.settings)).toEqual(["appearance", "compose", "inbox", "notifications", "receipts", "sync"]);
    expect(keys(b.settings.receipts!)).toEqual(["defaultOn", "enabled", "endpoint"]);
    const json = JSON.stringify(b);
    for (const banned of ["accessToken", "refreshToken", "token", "clientSecret", "clientId", "ya29", "secret-client", "idToken"]) expect(json).not.toContain(banned);
  });

  it("gives a Google account no password even when passwords are included", async () => {
    const b = await buildBundle(fakeSource(), { includePasswords: true });
    const google = b.accounts.find((a) => a.authKind === "oauth_google")!;
    expect("password" in google).toBe(false);
    expect(google.provider).toBe("gmail");
  });

  it("leaves every password out when not included", async () => {
    const b = await buildBundle(fakeSource(), { includePasswords: false });
    expect(b.accounts.some((a) => "password" in a)).toBe(false);
  });

  it("maps account ids to emails and drops entries tied to unknown accounts", async () => {
    const source = fakeSource({
      listRules: async () => [
        { id: 1, name: "mine", enabled: true, accountId: "a1", match: "all", conditions: [], actions: [], sortOrder: 0 },
        { id: 2, name: "global", enabled: true, accountId: null, match: "all", conditions: [], actions: [], sortOrder: 1 },
        { id: 3, name: "gone", enabled: true, accountId: "zz", match: "all", conditions: [], actions: [], sortOrder: 2 },
      ],
      listSignatures: async () => [
        { id: 1, name: "a", html: "", accountIds: ["a1"], defaultNew: false, defaultReply: false },
        { id: 2, name: "all", html: "", accountIds: [], defaultNew: false, defaultReply: false },
        { id: 3, name: "gone", html: "", accountIds: ["zz"], defaultNew: false, defaultReply: false },
      ],
    });
    const b = await buildBundle(source, { includePasswords: false });
    expect(b.rules.map((r) => [r.name, r.accountEmail])).toEqual([["mine", "neel@example.com"], ["global", null]]);
    expect(b.signatures.map((s) => [s.name, s.accountEmails])).toEqual([["a", ["neel@example.com"]], ["all", []]]);
  });

  it("skips disabled accounts and oversize pictures", async () => {
    const { ACCOUNTS } = await import("./testkit");
    const b = await buildBundle(fakeSource({ listAccounts: async () => [{ ...ACCOUNTS[0]!, enabled: false }, ACCOUNTS[1]!], avatar: async () => "x".repeat(70_000) }), { includePasswords: false });
    expect(b.accounts.map((a) => a.email)).toEqual(["neel@gmail.com"]);
    expect("avatar" in b.accounts[0]!).toBe(false);
  });

  it("counts accounts that have a password to include", async () => {
    expect(await countPasswordAccounts(fakeSource())).toBe(1);
  });
});

describe("parseBundle", () => {
  it("rejects malformed json, other versions and oversize input", () => {
    expect(() => parseBundle("{")).toThrow(BundleError);
    expect(() => parseBundle(JSON.stringify({ v: 2 }))).toThrow(BundleError);
    expect(() => parseBundle(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow(/too large/);
  });
});
