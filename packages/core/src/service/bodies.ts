import { logger } from "../log";
import type { Store } from "../store";
import type { MessageRowId } from "../types";
import type { SyncManager } from "./syncManager";

const log = logger("service.bodies");
const PARALLEL = 4;

/**
 * Downloads the bodies of messages that only have headers locally. Failures (offline, message gone)
 * are logged and skipped: the caller shows what it has.
 */
export async function ensureBodies(store: Store, syncs: SyncManager, messageIds: MessageRowId[]): Promise<void> {
  const todo = messageIds.map((id) => store.getMessage(id)).filter((m) => m !== null && !m.bodyLoaded);
  const queue = [...todo];
  const worker = async (): Promise<void> => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      try {
        await syncs.get(m.accountId).fetchBody(m.id);
      } catch (error) {
        log.warn("could not load a message body", { messageId: m.id, reason: (error as Error).message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
}
