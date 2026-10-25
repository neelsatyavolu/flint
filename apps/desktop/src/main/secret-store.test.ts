// @vitest-environment node
import { mkdtemp, readFile, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretStore, type SafeStorageLike } from "./secret-store";

function fakeSafeStorage(available: boolean): SafeStorageLike {
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (s) => Buffer.from(s, "utf8").reverse(),
    decryptStringAsync: async (b) => ({ result: Buffer.from(b).reverse().toString("utf8"), shouldReEncrypt: false }),
  };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "flint-secrets-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("secret store", () => {
  it("round trips values across instances and encrypts on disk", async () => {
    const file = join(dir, "secrets.bin");
    const a = createSecretStore(file, fakeSafeStorage(true));
    expect(await a.get("k")).toBeNull();
    await a.set("account:1", JSON.stringify({ password: "hunter2" }));
    await a.set("ai:tokens", "t");
    const raw = await readFile(file);
    expect(raw[0]).toBe(1);
    expect(raw.toString("utf8")).not.toContain("hunter2");
    const b = createSecretStore(file, fakeSafeStorage(true));
    expect(await b.get("account:1")).toBe(JSON.stringify({ password: "hunter2" }));
    await b.delete("account:1");
    await b.delete("missing");
    expect(await createSecretStore(file, fakeSafeStorage(true)).get("account:1")).toBeNull();
    expect(await createSecretStore(file, fakeSafeStorage(true)).get("ai:tokens")).toBe("t");
  });

  it("falls back to a 0600 plain file when safeStorage is unavailable", async () => {
    const file = join(dir, "secrets.bin");
    const s = createSecretStore(file, fakeSafeStorage(false), { allowPlain: true });
    await s.set("a", "b");
    const raw = await readFile(file);
    expect(raw[0]).toBe(0);
    expect(((await stat(file)).mode & 0o777).toString(8)).toBe("600");
    expect(await createSecretStore(file, fakeSafeStorage(false), { allowPlain: true }).get("a")).toBe("b");
  });

  it("refuses to read ciphertext when encryption is unavailable, without overwriting it", async () => {
    const file = join(dir, "secrets.bin");
    await createSecretStore(file, fakeSafeStorage(true)).set("a", "b");
    const before = await readFile(file);
    const s = createSecretStore(file, fakeSafeStorage(false));
    await expect(s.get("a")).rejects.toThrow(/keychain/);
    await expect(s.set("c", "d")).rejects.toThrow();
    expect((await readFile(file)).equals(before)).toBe(true);
  });

  it("rejects an unreadable file", async () => {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, "secrets.bin");
    await writeFile(file, Buffer.from([9, 1, 2]));
    await expect(createSecretStore(file, fakeSafeStorage(true)).get("a")).rejects.toThrow(/not readable/);
  });

  it("serializes concurrent writes and leaves no temp files", async () => {
    const file = join(dir, "nested", "secrets.bin");
    const s = createSecretStore(file, fakeSafeStorage(true));
    await Promise.all(Array.from({ length: 20 }, (_, i) => s.set(`k${i}`, String(i))));
    const fresh = createSecretStore(file, fakeSafeStorage(true));
    for (let i = 0; i < 20; i++) expect(await fresh.get(`k${i}`)).toBe(String(i));
    expect((await readdir(join(dir, "nested"))).sort()).toEqual(["secrets.bin", "secrets.bin.sealed"]);
  });

  it("refuses to store secrets without a keychain unless plain is allowed", async () => {
    const file = join(dir, "secrets.bin");
    await expect(createSecretStore(file, fakeSafeStorage(false)).set("a", "b")).rejects.toThrow(/keychain/);
    await expect(readFile(file)).rejects.toThrow();
  });

  it("re-encrypts a legacy plain file when encryption is available", async () => {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, "secrets.bin");
    await writeFile(file, Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({ a: "b" }))]));
    expect(await createSecretStore(file, fakeSafeStorage(true)).get("a")).toBe("b");
    expect((await readFile(file))[0]).toBe(1);
  });

  it("rejects a plain blob swapped in after an encrypted one was written", async () => {
    const { writeFile } = await import("node:fs/promises");
    const file = join(dir, "secrets.bin");
    await createSecretStore(file, fakeSafeStorage(true)).set("a", "b");
    await writeFile(file, Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({ a: "evil" }))]));
    await expect(createSecretStore(file, fakeSafeStorage(true)).get("a")).rejects.toThrow(/not trusted/);
  });

  it("keeps secrets in memory only, and tells the app once, when there is no keychain", async () => {
    const file = join(dir, "secrets.bin");
    let told = 0;
    const s = createSecretStore(file, fakeSafeStorage(false), { memoryOnly: true, onMemoryOnly: () => { told++; } });
    expect(await s.get("a")).toBeNull();
    await s.set("a", "b");
    await s.set("c", "d");
    expect(await s.get("a")).toBe("b");
    await s.delete("c");
    expect(await s.get("c")).toBeNull();
    expect(told).toBe(1);
    await expect(readFile(file)).rejects.toThrow();
    expect((await readdir(dir))).toEqual([]);
    expect(await createSecretStore(file, fakeSafeStorage(false), { memoryOnly: true }).get("a")).toBeNull();
  });

  it("memory-only mode leaves an existing encrypted file untouched", async () => {
    const file = join(dir, "secrets.bin");
    await createSecretStore(file, fakeSafeStorage(true)).set("a", "b");
    const before = await readFile(file);
    const s = createSecretStore(file, fakeSafeStorage(false), { memoryOnly: true });
    expect(await s.get("a")).toBeNull();
    await s.set("x", "y");
    expect(await s.get("x")).toBe("y");
    expect((await readFile(file)).equals(before)).toBe(true);
    expect(await createSecretStore(file, fakeSafeStorage(true)).get("a")).toBe("b");
  });

  it("re-encrypts when safeStorage says the key rotated", async () => {
    const file = join(dir, "secrets.bin");
    await createSecretStore(file, fakeSafeStorage(true)).set("a", "b");
    const rotating = { ...fakeSafeStorage(true), decryptStringAsync: async (b: Buffer) => ({ result: Buffer.from(b).reverse().toString("utf8"), shouldReEncrypt: true }) };
    expect(await createSecretStore(file, rotating).get("a")).toBe("b");
  });
});
