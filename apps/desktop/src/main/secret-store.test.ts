// @vitest-environment node
import { mkdtemp, readFile, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretStore, type SafeStorageLike } from "./secret-store";

function fakeSafeStorage(available: boolean): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(s, "utf8").reverse(),
    decryptString: (b) => Buffer.from(b).reverse().toString("utf8"),
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
    const s = createSecretStore(file, fakeSafeStorage(false));
    await s.set("a", "b");
    const raw = await readFile(file);
    expect(raw[0]).toBe(0);
    expect(((await stat(file)).mode & 0o777).toString(8)).toBe("600");
    expect(await createSecretStore(file, fakeSafeStorage(false)).get("a")).toBe("b");
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
    expect(await readdir(join(dir, "nested"))).toEqual(["secrets.bin"]);
  });
});
