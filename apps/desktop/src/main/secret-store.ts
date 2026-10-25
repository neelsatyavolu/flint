import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SecretStore } from "@flint/core/platform";
import { logger } from "@flint/core/log";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

const log = logger("secrets");
const TAG_ENCRYPTED = 0x01;
const TAG_PLAIN = 0x00;

type Blob = Record<string, string>;

/**
 * One encrypted JSON blob (secrets.bin). First byte tags the format: 0x01 is
 * safeStorage ciphertext, 0x00 is plain JSON used only when safeStorage is not
 * available (dev). Writes are atomic (temp file + rename) and serialized.
 */
export function createSecretStore(file: string, safeStorage: SafeStorageLike): SecretStore {
  let cache: Blob | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Blob> {
    if (cache) return cache;
    let raw: Buffer;
    try {
      raw = await readFile(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        cache = {};
        return cache;
      }
      throw err;
    }
    if (raw.length === 0) {
      cache = {};
      return cache;
    }
    const tag = raw[0];
    const body = raw.subarray(1);
    let json: string;
    if (tag === TAG_ENCRYPTED) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Saved credentials are encrypted and the system keychain is not available.");
      }
      json = safeStorage.decryptString(body);
    } else if (tag === TAG_PLAIN) {
      json = body.toString("utf8");
    } else {
      throw new Error("Saved credentials file is not readable.");
    }
    cache = JSON.parse(json) as Blob;
    return cache;
  }

  async function persist(next: Blob): Promise<void> {
    const json = JSON.stringify(next);
    let payload: Buffer;
    if (safeStorage.isEncryptionAvailable()) {
      payload = Buffer.concat([Buffer.from([TAG_ENCRYPTED]), safeStorage.encryptString(json)]);
    } else {
      log.warn("safeStorage unavailable; storing secrets in a plain 0600 file");
      payload = Buffer.concat([Buffer.from([TAG_PLAIN]), Buffer.from(json, "utf8")]);
    }
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, payload, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
    cache = next;
  }

  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  }

  return {
    get: (key) => serialized(async () => (await load())[key] ?? null),
    set: (key, value) =>
      serialized(async () => {
        const current = await load();
        await persist({ ...current, [key]: value });
      }),
    delete: (key) =>
      serialized(async () => {
        const current = await load();
        if (!(key in current)) return;
        const { [key]: _removed, ...rest } = current;
        await persist(rest);
      }),
  };
}
