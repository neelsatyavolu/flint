import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { safeFilename } from "../mail/sync/attachments";
import { FlintError } from "../types";
import { quarantine, riskyExtension } from "./attachmentSafety";
import type { ServiceContext } from "./context";

async function writeUnique(dir: string, filename: string, data: Buffer): Promise<string> {
  await mkdir(dir, { recursive: true });
  const ext = extname(filename);
  const stem = basename(filename, ext);
  for (let n = 0; n < 1000; n++) {
    const path = join(dir, n === 0 ? filename : `${stem} (${n})${ext}`);
    try {
      await writeFile(path, data, { flag: "wx" });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new FlintError("conflict", "Too many files with that name in the downloads folder.");
}

function ownerOf(ctx: ServiceContext, attachmentId: number): { accountId: string; filename: string } {
  const att = ctx.store.getAttachment(attachmentId);
  const msg = att ? ctx.store.getMessage(att.messageRowId) : null;
  if (!att || !msg) throw new FlintError("not_found", "That attachment no longer exists.");
  return { accountId: msg.accountId, filename: att.filename };
}

/** Saves to the downloads folder under a unique name, or to `path` (a file the user picked). Agents may not choose a path. */
export async function saveAttachment(ctx: ServiceContext, attachmentId: number, path?: string): Promise<string> {
  const { accountId, filename } = ownerOf(ctx, attachmentId);
  if (path !== undefined && ctx.caller()) throw new FlintError("permission", "Agents can only save attachments to the downloads folder.");
  if (path !== undefined && !isAbsolute(path)) throw new FlintError("invalid", "Choose a full file path.");
  const data = await ctx.syncs.get(accountId).fetchAttachment(attachmentId);
  if (path === undefined) {
    const saved = await writeUnique(ctx.platform.downloadsDir, safeFilename(filename), data);
    await quarantine(saved);
    return saved;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  await quarantine(path);
  return path;
}

/** Fetches (or reuses the cached copy) and opens it with the system's default app. */
export async function openAttachment(ctx: ServiceContext, attachmentId: number): Promise<void> {
  const { accountId, filename } = ownerOf(ctx, attachmentId);
  const risky = riskyExtension(filename);
  if (risky) {
    throw new FlintError("permission", `Flint won't open ${risky} files because they can run code. Save it and check where it came from before opening it.`);
  }
  await ctx.syncs.get(accountId).fetchAttachment(attachmentId);
  const cached = ctx.store.getAttachment(attachmentId)?.cachedPath;
  if (!cached) throw new FlintError("internal", "The attachment could not be opened.");
  await quarantine(cached);
  await ctx.platform.openPath(cached);
}
