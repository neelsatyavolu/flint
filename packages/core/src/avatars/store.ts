import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../log";
import { safeFilename } from "../mail/sync/attachments";
import { MAX_AVATAR_BYTES, sniffImage, toDataUrl } from "./images";
import { createLimiter } from "./limiter";

const log = logger("avatars");

export const FETCH_TIMEOUT_MS = 5_000;
export const MAX_CONCURRENT_FETCHES = 3;
/** A found photo is reused this long before Gravatar is asked again. */
export const POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** "No photo" (Gravatar 404) is remembered for a day. */
export const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
/** A failed lookup (offline, timeout, server error) is retried after this. */
export const ERROR_TTL_MS = 15 * 60 * 1000;

export type AccountPhotoKind = "custom" | "google";

export type AvatarStoreOptions = { dir: string; now: () => number; fetch: typeof fetch };

type SenderEntry = { expiresAt: number; data: string | null };

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Reads a response body up to `max` bytes. Null when it is larger, without buffering the rest. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.length > max ? null : all;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Disk-backed profile pictures under one directory. Everything it fetches is public and anonymous. */
export class AvatarStore {
  private readonly limit = createLimiter(MAX_CONCURRENT_FETCHES);
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly o: AvatarStoreOptions) {}

  private accountFile(accountId: string, kind: AccountPhotoKind): string {
    return join(this.o.dir, "accounts", `${safeFilename(accountId, "account")}.${kind}.img`);
  }

  private senderFile(address: string): string {
    return join(this.o.dir, "senders", `${sha256(address)}.json`);
  }

  async saveAccountPhoto(accountId: string, kind: AccountPhotoKind, bytes: Uint8Array): Promise<void> {
    const file = this.accountFile(accountId, kind);
    await mkdir(join(this.o.dir, "accounts"), { recursive: true });
    await writeFile(file, bytes);
  }

  async removeAccountPhoto(accountId: string, kind: AccountPhotoKind): Promise<void> {
    await rm(this.accountFile(accountId, kind), { force: true });
  }

  async removeAccount(accountId: string): Promise<void> {
    await Promise.all((["custom", "google"] as const).map((k) => this.removeAccountPhoto(accountId, k)));
  }

  async accountPhoto(accountId: string, kind: AccountPhotoKind): Promise<string | null> {
    try {
      const bytes = await readFile(this.accountFile(accountId, kind));
      const mime = sniffImage(bytes);
      return mime ? toDataUrl(bytes, mime) : null;
    } catch {
      return null;
    }
  }

  async hasAccountPhoto(accountId: string, kind: AccountPhotoKind): Promise<boolean> {
    return (await this.accountPhoto(accountId, kind)) !== null;
  }

  /** Downloads a public image anonymously: no cookies, no referrer, 5 s timeout, size capped. Null on a 404 or any failure. */
  async download(url: string): Promise<{ bytes: Uint8Array; notFound: false } | { bytes: null; notFound: boolean }> {
    try {
      const res = await this.limit(() => this.o.fetch(url, {
        method: "GET", credentials: "omit", referrer: "", referrerPolicy: "no-referrer", redirect: "follow",
        headers: { accept: "image/*" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      }));
      if (res.status === 404) return { bytes: null, notFound: true };
      if (!res.ok) return { bytes: null, notFound: false };
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_AVATAR_BYTES) return { bytes: null, notFound: false };
      const bytes = await readCapped(res, MAX_AVATAR_BYTES);
      if (!bytes || bytes.length === 0 || !sniffImage(bytes)) return { bytes: null, notFound: false };
      return { bytes, notFound: false };
    } catch (error) {
      log.info("avatar download failed", { reason: (error as Error).name });
      return { bytes: null, notFound: false };
    }
  }

  /** Gravatar photo for an address as a data URL, or null. Hits the disk cache first; the address is hashed before it leaves. */
  senderPhoto(address: string): Promise<string | null> {
    const key = address.trim().toLowerCase();
    const running = this.inflight.get(key);
    if (running) return running;
    const task = this.loadSender(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    return task;
  }

  private async loadSender(address: string): Promise<string | null> {
    const file = this.senderFile(address);
    try {
      const entry = JSON.parse(await readFile(file, "utf8")) as SenderEntry;
      if (typeof entry.expiresAt === "number" && entry.expiresAt > this.o.now()) return entry.data;
    } catch {
      /* no cache entry yet */
    }
    const got = await this.download(`https://www.gravatar.com/avatar/${sha256(address)}?s=128&d=404`);
    const data = got.bytes ? toDataUrl(got.bytes, sniffImage(got.bytes)!) : null;
    const ttl = data ? POSITIVE_TTL_MS : got.notFound ? NEGATIVE_TTL_MS : ERROR_TTL_MS;
    try {
      await mkdir(join(this.o.dir, "senders"), { recursive: true });
      await writeFile(file, JSON.stringify({ expiresAt: this.o.now() + ttl, data } satisfies SenderEntry));
    } catch (error) {
      log.warn("could not cache an avatar", { reason: (error as Error).message });
    }
    return data;
  }
}
