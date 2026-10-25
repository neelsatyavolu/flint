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
