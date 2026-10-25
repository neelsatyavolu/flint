import type { FlintApi } from "@flint/core/api";
import type { Settings } from "@flint/core/types";

const PAGE = 200;
const MAX_PAGES = 25;

/**
 * The number the dock badge shows: unread threads in the unified inbox, unread people threads there, or nothing.
 * Both counts leave out accounts hidden from the unified inbox.
 */
export async function badgeCount(mode: Settings["notifications"]["badge"], api: Pick<FlintApi, "getSidebar" | "listThreads">): Promise<number> {
  if (mode === "off") return 0;
  if (mode === "unified_unread") return (await api.getSidebar()).counts.inbox;
  let total = 0;
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await api.listThreads({ view: "inbox", focused: true, unreadOnly: true, limit: PAGE, ...(cursor ? { cursor } : {}) });
    total += page.items.length;
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return total;
}

export type BadgeDeps = {
  getUnread: () => Promise<number>;
  setBadge: (count: number) => void;
  throttleMs?: number;
};

/**
 * Throttled dock badge updater. The first request runs now; further requests
 * within the window collapse into one trailing run.
 */
export function createBadgeUpdater({ getUnread, setBadge, throttleMs = 1000 }: BadgeDeps) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<void> => {
    last = Date.now();
    try {
      setBadge(Math.max(0, await getUnread()));
    } catch {
      // Keep the previous badge when the count is unavailable.
    }
  };

  return {
    request(): void {
      if (timer) return;
      const wait = Math.max(0, last + throttleMs - Date.now());
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, wait);
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
