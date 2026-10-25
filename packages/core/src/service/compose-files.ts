import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { safeFilename } from "../mail/sync/attachments";
import { FlintError, type DraftAttachment } from "../types";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".html": "text/html", ".htm": "text/html", ".json": "application/json",
  ".pdf": "application/pdf", ".zip": "application/zip", ".gz": "application/gzip", ".tar": "application/x-tar",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".heic": "image/heic",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".ics": "text/calendar", ".eml": "message/rfc822",
};

export function contentTypeFor(filename: string): string {
  return TYPES[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

export const draftDir = (dataDir: string, draftId: number): string => join(dataDir, "drafts", String(draftId));

/** Picks a name that is not taken by an attachment already on the draft. */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const ext = extname(name);
  const stem = basename(name, ext);
  for (let n = 1; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!taken.has(next)) return next;
  }
}

function describe(dir: string, name: string, size: number, contentType: string): DraftAttachment {
  return { id: randomUUID(), filename: name, contentType, size, path: join(dir, name) };
}

/** Copies a file the user chose into the draft's folder. */
export async function copyIntoDraft(dir: string, source: string, existing: readonly DraftAttachment[]): Promise<DraftAttachment> {
  let info;
  try {
    info = await stat(source);
  } catch {
    throw new FlintError("not_found", "Flint couldn't find that file.");
  }
  if (!info.isFile()) throw new FlintError("invalid", "Choose a file, not a folder.");
  if (info.size > MAX_ATTACHMENT_BYTES) throw new FlintError("invalid", "That file is larger than 25 MB.");
  const name = uniqueName(safeFilename(basename(source)), new Set(existing.map((a) => a.filename)));
  await mkdir(dir, { recursive: true });
  const att = describe(dir, name, info.size, contentTypeFor(name));
  await copyFile(source, att.path);
  return att;
}

/** Saves bytes (a forwarded attachment) into the draft's folder. */
export async function writeIntoDraft(dir: string, filename: string, contentType: string, data: Buffer, existing: readonly DraftAttachment[]): Promise<DraftAttachment> {
  const name = uniqueName(safeFilename(filename || "attachment"), new Set(existing.map((a) => a.filename)));
  await mkdir(dir, { recursive: true });
  const att = describe(dir, name, data.length, contentType || contentTypeFor(name));
  await writeFile(att.path, data);
  return att;
}

/** Removes a file only when it sits inside the draft's own folder. */
export async function removeDraftFile(dir: string, path: string): Promise<void> {
  const root = resolve(dir) + sep;
  if (!resolve(path).startsWith(root)) return;
  await rm(path, { force: true });
}

export async function removeDraftDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}
