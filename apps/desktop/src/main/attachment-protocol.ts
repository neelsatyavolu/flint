import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@flint/core/log";
import type { FlintApi } from "@flint/core/api";
import { protocol } from "electron";
import { parseAttachmentUrl, sniffImageType } from "./attachment-url";

const log = logger("attachment-protocol");

/** Scheme core's mail sanitizer writes into inline images: flint-attachment://<attachmentId>. */
export const ATTACHMENT_SCHEME = "flint-attachment";

export const attachmentSchemeRegistration = {
  scheme: ATTACHMENT_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true },
} as const;

/** Serves inline mail images by fetching the attachment through the service into a private temp dir. */
export function serveAttachments(getApi: () => FlintApi | null, dataDir: string): void {
  const dir = join(dataDir, "attachment-tmp");
  protocol.handle(ATTACHMENT_SCHEME, async (request) => {
    const id = parseAttachmentUrl(request.url);
    const api = getApi();
    if (id === null || !api) return new Response("Not found", { status: 404 });
    const path = join(dir, `${id}.bin`);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await api.saveAttachment(id, path);
      const bytes = await readFile(path);
      await rm(path, { force: true });
      return new Response(new Uint8Array(bytes), {
        headers: { "content-type": sniffImageType(bytes), "x-content-type-options": "nosniff", "cache-control": "private, max-age=3600" },
      });
    } catch (err) {
      log.warn("inline attachment failed", { id, reason: err instanceof Error ? err.message : String(err) });
      return new Response("Not found", { status: 404 });
    }
  });
}
