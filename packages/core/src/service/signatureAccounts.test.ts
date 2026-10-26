import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { memorySecrets, type Platform } from "../platform";
import { libraryApi } from "./compose-library";
import { createContext } from "./context";

describe("saveSignature through the service", () => {
  it("accepts real accounts and rejects an unknown one as invalid", async () => {
    const ctx = createContext({ dataDir: mkdtempSync(join(tmpdir(), "flint-sig-")), secrets: memorySecrets() } as unknown as Platform, { dbPath: ":memory:" });
    const base = { provider: "imap" as const, authKind: "password" as const, imapHost: "x", imapPort: 993, imapSecure: true, smtpHost: "x", smtpPort: 465, smtpSecure: true };
    const a = ctx.store.createAccount({ ...base, email: "a@x.co", username: "a" });
    const b = ctx.store.createAccount({ ...base, email: "b@x.co", username: "b" });
    const api = libraryApi(ctx);
    const saved = await api.saveSignature({ name: "Both", html: "<p>x</p>", accountIds: [a.id, b.id], defaultNew: false, defaultReply: false });
    expect(saved.accountIds).toEqual([a.id, b.id]);
    await expect(api.saveSignature({ name: "Bad", html: "", accountIds: [a.id, "nope"], defaultNew: false, defaultReply: false })).rejects.toMatchObject({ code: "invalid" });
    expect(await api.listSignatures()).toHaveLength(1);
  });
});
