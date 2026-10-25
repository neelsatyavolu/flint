import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { memorySecrets, type Platform } from "../platform";
import { defaultSignature } from "./compose-signature";
import { createContext } from "./context";
import { importSparkApi } from "./importSpark";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

type Row = { group: string; key: string; value: unknown };
const sig = (id: string, html: string, extra: Record<string, unknown> = {}): Row => ({
  group: "SignaturesSettingsItemsGroup", key: id,
  value: { identifier: id, htmlContent: html, deleted: false, creationDate: 811396246.1, modificationDate: 812066067.4, ...extra },
});

function sparkDb(rows: Row[], path = join(mkdtempSync(join(tmpdir(), "spark-svc-")), "settings.sqlite")): string {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE settings ( pk INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, itemGroup TEXT NOT NULL, itemKey TEXT NOT NULL, itemValue BLOB, syncDate INTEGER NOT NULL, syncStatus INTEGER )");
  const insert = db.prepare("INSERT INTO settings (itemGroup, itemKey, itemValue, syncDate) VALUES (?, ?, ?, 0)");
  for (const r of rows) insert.run(r.group, r.key, Buffer.from(JSON.stringify(r.value)));
  db.close();
  return path;
}

const bindings = (map: Record<string, string>): Row => ({ group: "MetaSettingsItemsGroup", key: "MetaBindingSettingsKey", value: map });
const bigLogo = `<div><img src="data:image/png;base64,${"A".repeat(80_000)}"></div>`;

function rig(sparkHome?: string) {
  const dataDir = mkdtempSync(join(tmpdir(), "flint-svc-"));
  const platform = { dataDir, secrets: memorySecrets() } as unknown as Platform;
  const ctx = createContext(platform, { dbPath: ":memory:", ...(sparkHome ? { sparkHome } : {}) });
  const base = { provider: "imap" as const, authKind: "password" as const, imapHost: "x", imapPort: 993, imapSecure: true, smtpHost: "x", smtpPort: 465, smtpSecure: true };
  const xanom = ctx.store.createAccount({ ...base, email: "neel@xanom.co", username: "a" });
  const nenu = ctx.store.createAccount({ ...base, email: "neel@nenu.co", username: "b", aliases: ["hello@nenu.co"] });
  return { ctx, api: importSparkApi(ctx), xanom, nenu };
}

const fixture = () => sparkDb([
  sig("A", `<div>--</div><div>Neel Satyavolu</div><div>Executive Producer</div>${bigLogo}`, { modificationDate: 814470348.2 }),
  sig("B", "<div>Thanks,</div><div>Neel</div>"),
  bindings({ "Neel@Xanom.co": "A", "hello@nenu.co": "B", "stranger@x.org": "B" }),
]);

describe("findSparkSignatures", () => {
  it("returns null when Spark is not installed", async () => {
    const { api } = rig(mkdtempSync(join(tmpdir(), "no-spark-")));
    expect(await api.findSparkSignatures()).toBeNull();
  });

  it("finds the App Store container and matches Flint accounts by address or alias", async () => {
    const home = mkdtempSync(join(tmpdir(), "spark-home-"));
    const dir = join(home, "Library", "Containers", "com.readdle.SparkDesktop.appstore", "Data", "Library", "Application Support", "Spark Desktop", "core-data");
    mkdirSync(dir, { recursive: true });
    sparkDb([sig("A", "<div>Neel</div>"), bindings({ "neel@xanom.co": "A", "hello@nenu.co": "A" })], join(dir, "settings.sqlite"));
    const { api, xanom, nenu } = rig(home);
    const scan = await api.findSparkSignatures();
    expect(scan?.signatures).toHaveLength(1);
    expect(scan!.signatures[0]!.matches).toEqual([{ accountId: xanom.id, email: "neel@xanom.co" }, { accountId: nenu.id, email: "neel@nenu.co" }]);
  });

  it("reads a file chosen by hand", async () => {
    const { api } = rig();
    const scan = await api.findSparkSignatures(fixture());
    expect(scan?.signatures.map((s) => s.sparkId)).toEqual(["A", "B"]);
    expect(scan!.signatures[1]!.matches.map((m) => m.email)).toEqual(["neel@nenu.co"]);
  });

  it("explains a file that is not a Spark database", async () => {
    const { api } = rig();
    const bad = join(mkdtempSync(join(tmpdir(), "bad-")), "settings.sqlite");
    writeFileSync(bad, "not sqlite");
    await expect(api.findSparkSignatures(bad)).rejects.toMatchObject({ code: "invalid" });
  });

  it.skipIf(process.getuid?.() === 0)("maps a file macOS will not let Flint read to a permission error", async () => {
    const { api } = rig();
    const path = fixture();
    chmodSync(path, 0o000);
    const expected = { code: "permission", message: "macOS blocked Flint from reading Spark's settings. Allow Flint under System Settings → Privacy & Security → App Management or Full Disk Access, then try again." };
    await expect(api.findSparkSignatures(path)).rejects.toMatchObject(expected);
    await expect(api.importSparkSignatures({ path, items: [{ sparkId: "A", setDefaultFor: [] }] })).rejects.toMatchObject(expected);
  });
});

describe("importSparkSignatures", () => {
  it("imports shared signatures, large logo included, and sets each account's default", async () => {
    const { api, ctx, xanom, nenu } = rig();
    const path = fixture();
    const out = await api.importSparkSignatures({ path, items: [
      { sparkId: "A", name: "Work", setDefaultFor: [xanom.id] },
      { sparkId: "B", setDefaultFor: [nenu.id] },
    ] });
    expect(out.map((s) => s.name)).toEqual(["Work", "Thanks,"]);
    expect(out.every((s) => s.accountId === null)).toBe(true);
    expect(out[0]!.html.length).toBeGreaterThan(80_000);
    expect(out[0]!.html.startsWith("<div>--</div><div>Neel Satyavolu</div>")).toBe(true);
    expect(ctx.getSettings().compose.defaultSignatureByAccount).toEqual({ [xanom.id]: out[0]!.id, [nenu.id]: out[1]!.id });
    for (const mode of ["new", "reply"] as const) {
      expect(defaultSignature(ctx.store, ctx.getSettings(), xanom.id, mode)?.id).toBe(out[0]!.id);
      expect(defaultSignature(ctx.store, ctx.getSettings(), nenu.id, mode)?.id).toBe(out[1]!.id);
    }
  });

  it("updates in place when imported again, even after a rename", async () => {
    const { api, ctx, xanom } = rig();
    const path = fixture();
    const [first] = await api.importSparkSignatures({ path, items: [{ sparkId: "A", setDefaultFor: [xanom.id] }] });
    const [again] = await api.importSparkSignatures({ path, items: [{ sparkId: "A", name: "Renamed", setDefaultFor: [] }] });
    expect(again!.id).toBe(first!.id);
    expect(ctx.store.listSignatures()).toHaveLength(1);
    expect(ctx.store.listSignatures()[0]!.name).toBe("Renamed");
    expect(ctx.getSettings().compose.defaultSignatureByAccount[xanom.id]).toBe(first!.id);
  });

  it("imports again as a new signature after the earlier copy was deleted", async () => {
    const { api, ctx } = rig();
    const path = fixture();
    const [first] = await api.importSparkSignatures({ path, items: [{ sparkId: "B", setDefaultFor: [] }] });
    ctx.store.deleteSignature(first!.id);
    const [again] = await api.importSparkSignatures({ path, items: [{ sparkId: "B", setDefaultFor: [] }] });
    expect(again!.html).toBe(first!.html);
    expect(ctx.store.listSignatures()).toHaveLength(1);
  });

  it("reuses an identical signature that was typed in by hand", async () => {
    const { api, ctx } = rig();
    const path = fixture();
    const scan = await api.findSparkSignatures(path);
    const b = scan!.signatures.find((s) => s.sparkId === "B")!;
    const mine = ctx.store.saveSignature({ name: "Mine", html: b.html, accountId: null, defaultNew: false, defaultReply: false });
    const [out] = await api.importSparkSignatures({ path, items: [{ sparkId: "B", setDefaultFor: [] }] });
    expect(out!.id).toBe(mine.id);
  });

  it("rejects unknown accounts and signatures, and an empty selection, without saving anything", async () => {
    const { api, ctx, xanom } = rig();
    const path = fixture();
    await expect(api.importSparkSignatures({ path, items: [{ sparkId: "A", setDefaultFor: ["nope"] }] })).rejects.toMatchObject({ code: "not_found" });
    await expect(api.importSparkSignatures({ path, items: [{ sparkId: "A", setDefaultFor: [xanom.id] }, { sparkId: "Z", setDefaultFor: [] }] })).rejects.toMatchObject({ code: "not_found" });
    await expect(api.importSparkSignatures({ path, items: [] })).rejects.toMatchObject({ code: "invalid" });
    expect(ctx.store.listSignatures()).toHaveLength(0);
  });

  it("says so when Spark is not installed", async () => {
    const { api } = rig(mkdtempSync(join(tmpdir(), "no-spark-")));
    await expect(api.importSparkSignatures({ items: [{ sparkId: "A", setDefaultFor: [] }] })).rejects.toMatchObject({ code: "not_found" });
  });
});
