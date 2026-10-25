import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImapFlow } from "imapflow";
import { FlintError } from "../../types";

/** A filename that cannot escape its folder or upset a file system. */
export function safeFilename(name: string, fallback = "attachment"): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[\\/:*?"<>|]+/g, "_").replace(/^[.\s]+/, "").replace(/[.\s]+$/, "").trim();
  if (!cleaned) return fallback;
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 12 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export const attachmentPath = (dataDir: string, accountId: string, messageRowId: number, attachmentId: number, filename: string): string =>
  join(dataDir, "attachments", safeFilename(accountId, "account"), String(messageRowId), `${attachmentId}-${safeFilename(filename)}`);

export async function readCached(path: string | null): Promise<Buffer | null> {
  if (!path) return null;
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export async function writeCached(path: string, data: Buffer): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const tmp = `${path}.part`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/** Downloads one body part, transfer encoding removed. The mailbox must be selected (hold a lock). */
export async function downloadPart(client: ImapFlow, uid: number, part: string): Promise<Buffer> {
  const res = await client.download(String(uid), part, { uid: true });
  if (!res.content) throw new FlintError("not_found", "That attachment is no longer on the server.");
  const chunks: Buffer[] = [];
  for await (const chunk of res.content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}
