import { logger } from "../log";
import type { Store } from "../store";
import type { MessageRowId } from "../types";
import type { SyncManager } from "./syncManager";

const log = logger("service.bodies");
const PARALLEL = 4;
/** How long one body fetch may hold up the others waiting behind it; the fetch itself carries on and lands in the store. */
export const BODY_FETCH_TIMEOUT_MS = 8_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); timer.unref(); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Downloads the bodies of messages that only have headers locally. Failures (offline, message gone)
 * are logged and skipped: the caller shows what it has.
 */
export async function ensureBodies(store: Store, syncs: SyncManager, messageIds: MessageRowId[], timeoutMs = BODY_FETCH_TIMEOUT_MS): Promise<void> {
  const todo = messageIds.map((id) => store.getMessage(id)).filter((m) => m !== null && !m.bodyLoaded);
  const queue = [...todo];
  const worker = async (): Promise<void> => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      try {
        const fetching = syncs.get(m.accountId).fetchBody(m.id);
        fetching.catch(() => undefined);
        await withTimeout(fetching, timeoutMs);
      } catch (error) {
        log.warn("could not load a message body", { messageId: m.id, reason: (error as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
}
