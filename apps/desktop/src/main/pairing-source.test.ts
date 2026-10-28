import { describe, expect, it, vi } from "vitest";
import { memorySecrets } from "@flint/core/platform";
import type { Account } from "@flint/core/types";
import { buildBundle } from "@flint/core/pairing/bundle";
import { macName, serviceBundleSource } from "./pairing-source";

const account = (id: string, authKind: Account["authKind"]): Account => ({
  id, email: `${id}@example.com`, name: id, provider: authKind === "oauth_google" ? "gmail" : "imap", authKind, color: null, sortOrder: 0, enabled: true, aliases: [],
  createdAt: 1, showInUnified: true, avatarSource: null, avatarUpdatedAt: null, calendarScope: false, imapHost: "imap.example.com", imapPort: 993, imapSecure: true,
  smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, username: `${id}@example.com`,
});

function api() {
  return {
    listAccounts: vi.fn(async () => [account("pw", "password"), account("g", "oauth_google")]),
    listSignatures: vi.fn(async () => []), listTemplates: vi.fn(async () => []), listRules: vi.fn(async () => []), listBlocked: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ compose: { undoSendSeconds: 10 }, sync: { initialDays: 90, bodiesForRecentDays: 30 }, inbox: { focused: true }, receipts: { enabled: false, defaultOn: false, endpoint: "" }, appearance: { theme: "system" }, notifications: { scope: "people" } }) as never),
    getAvatars: vi.fn(async () => ({})),
  };
}

describe("serviceBundleSource", () => {
  it("reads app passwords from the secret store and never an OAuth token", async () => {
    const secrets = memorySecrets({
      "account:pw": JSON.stringify({ password: "hunter2" }),
      "account:g": JSON.stringify({ accessToken: "ya29.a", refreshToken: "1//r", expiresAt: 9 }),
    });
    const source = serviceBundleSource(api(), secrets, () => "Neel's Mac.local", () => 5);
    expect(await source.password("pw")).toBe("hunter2");
    expect(await source.password("g")).toBeNull();
    expect(await source.password("missing")).toBeNull();
    const bundle = await buildBundle(source, { includePasswords: true });
    expect(bundle.device.name).toBe("Neel's Mac");
    const text = JSON.stringify(bundle);
    expect(text).toContain("hunter2");
    expect(text).not.toMatch(/ya29|1\/\/r|accessToken|refreshToken/);
  });

  it("treats an unreadable secret as no password", async () => {
    const source = serviceBundleSource(api(), memorySecrets({ "account:pw": "{{" }), () => "Mac");
    expect(await source.password("pw")).toBeNull();
  });

  it("names the Mac from its host name", () => {
    expect(macName("Neels-MacBook-Pro.local")).toBe("Neels-MacBook-Pro");
    expect(macName("")).toBe("Mac");
  });
});
