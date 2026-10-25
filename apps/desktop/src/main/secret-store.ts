import { access, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SecretStore } from "@flint/core/platform";
import { logger } from "@flint/core/log";

/** The async safeStorage API (the sync one is deprecated in Electron 45). */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export type SecretStoreOptions = {
  /** Dev only: store a plain 0600 file when there is no keychain. */
  allowPlain?: boolean;
  /**
   * Packaged builds: without a keychain keep secrets in memory for this session (never on disk) and
   * call `onMemoryOnly` once so the app can tell the user. An existing encrypted file is left untouched.
   */
  memoryOnly?: boolean;
  onMemoryOnly?: () => void;
};

const log = logger("secrets");
const TAG_ENCRYPTED = 0x01;
const TAG_PLAIN = 0x00;

type Blob = Record<string, string>;

/**
 * One encrypted JSON blob (secrets.bin). First byte tags the format: 0x01 is
 * safeStorage ciphertext, 0x00 is plain JSON used only when safeStorage is not
 * available and `allowPlain` is set (dev only). Packaged builds pass allowPlain false, so without
 * a keychain they refuse to store secrets. Once an encrypted blob has been written a `.sealed`
 * marker is left beside it and a plain blob is never accepted again; a plain blob found while
 * encryption is available and no marker exists is a legacy file and is re-encrypted at once.
 * With `memoryOnly`, a missing keychain does not throw: secrets live in memory for the session.
 * Writes are atomic (temp file + rename) and serialized.
 */
export function createSecretStore(
  file: string,
  safeStorage: SafeStorageLike,
  options: SecretStoreOptions = {},
): SecretStore {
  const allowPlain = options.allowPlain ?? false;
  const memoryOnly = options.memoryOnly ?? false;
  let inMemory = false;
  const goMemoryOnly = (): void => {
    if (inMemory) return;
    inMemory = true;
    log.error("system keychain unavailable; keeping credentials in memory for this session only");
    options.onMemoryOnly?.();
  };
  const sealedFile = `${file}.sealed`;
  const isSealed = (): Promise<boolean> => access(sealedFile).then(() => true, () => false);
  let cache: Blob | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<Blob> {
    if (cache) return cache;
    if (inMemory) {
      cache = {};
      return cache;
    }
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
    let migrate = false;
    const encryption = await safeStorage.isAsyncEncryptionAvailable();
    if (tag === TAG_ENCRYPTED) {
      if (!encryption) {
        if (memoryOnly) return startInMemory();
        throw new Error("Saved credentials are encrypted and the system keychain is not available.");
      }
      const decrypted = await safeStorage.decryptStringAsync(body);
      json = decrypted.result;
      migrate = decrypted.shouldReEncrypt;
    } else if (tag === TAG_PLAIN) {
      if (encryption) {
        if (await isSealed()) throw new Error("Saved credentials file was modified and was not trusted.");
        migrate = true;
      } else if (memoryOnly) {
        return startInMemory();
      } else if (!allowPlain) {
        throw new Error("Flint can't read saved credentials because the system keychain is not available.");
      }
      json = body.toString("utf8");
    } else {
      throw new Error("Saved credentials file is not readable.");
    }
    const parsed = JSON.parse(json) as Blob;
    if (migrate) await persist(parsed);
    cache = parsed;
    return cache;
  }

  /** No keychain: start empty and never touch the file on disk. */
  function startInMemory(): Blob {
    goMemoryOnly();
    cache = {};
    return cache;
  }

  async function persist(next: Blob): Promise<void> {
    if (inMemory) {
      cache = next;
      return;
    }
    const json = JSON.stringify(next);
    let payload: Buffer;
    if (await safeStorage.isAsyncEncryptionAvailable()) {
      payload = Buffer.concat([Buffer.from([TAG_ENCRYPTED]), await safeStorage.encryptStringAsync(json)]);
    } else {
      if (memoryOnly) {
        goMemoryOnly();
        cache = next;
        return;
      }
      if (!allowPlain) {
        throw new Error("Flint can't save credentials because the system keychain is not available.");
      }
      log.warn("safeStorage unavailable; storing secrets in a plain 0600 file");
      payload = Buffer.concat([Buffer.from([TAG_PLAIN]), Buffer.from(json, "utf8")]);
    }
    await mkdir(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, payload, { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, file);
    if (payload[0] === TAG_ENCRYPTED) await writeFile(sealedFile, "", { mode: 0o600 });
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
