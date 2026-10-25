import type { FlintApi, Settings, ThreadId } from "@flint/core";
import type { ListStore } from "./listStore";

export const READ_DELAY_MS = 1500;

/**
 * Marks a thread read after it is opened, per settings.inbox.markReadOnOpen.
 * Returns a cancel function (the user moved on before the delay passed).
 */
export function scheduleMarkRead(
  deps: { api: Pick<FlintApi, "markRead">; list: ListStore },
  mode: Settings["inbox"]["markReadOnOpen"],
  threadId: ThreadId,
): () => void {
  if (mode === "never") return () => undefined;
  const run = () => {
    const item = deps.list.getState().raw.find((i) => i.id === threadId);
    if (item && item.unreadCount === 0) return;
    deps.list.getState().patchItems([threadId], { unreadCount: 0 });
    deps.api.markRead([threadId], true).catch(() => {
      if (item) deps.list.getState().patchItems([threadId], { unreadCount: item.unreadCount });
    });
  };
  if (mode === "instant") {
    run();
    return () => undefined;
  }
  const t = setTimeout(run, READ_DELAY_MS);
  return () => clearTimeout(t);
}
