export type SaveState = "idle" | "saving" | "saved" | "error";

export type Autosaver<P extends object> = {
  /** Merges `part` into the pending patch and restarts the debounce timer. */
  push(part: Partial<P>): void;
  /** Saves any pending patch now and resolves once every save has finished. Rejects if the last save failed. */
  flush(): Promise<void>;
  /** Drops the pending patch and the timer. */
  cancel(): void;
  hasPending(): boolean;
};

type Options<P extends object> = {
  save: (patch: Partial<P>) => Promise<unknown>;
  delayMs?: number;
  onState?: (state: SaveState) => void;
};

export const AUTOSAVE_MS = 800;
/** Waits before each retry after a failed save. After the last one, the next edit or flush tries again. */
export const RETRY_MS = [2000, 5000, 15000] as const;

/** Savers with unsaved work. Leaving the page flushes them all. */
const unsaved = new Set<Autosaver<object>>();
let exitHooked = false;

/** Starts a save for every autosaver that has unsaved work. Runs on pagehide and beforeunload. */
export function flushAllAutosavers(): void {
  for (const saver of unsaved) void saver.flush().catch(() => undefined);
}

function hookExit(): void {
  if (exitHooked || typeof window === "undefined") return;
  exitHooked = true;
  window.addEventListener("pagehide", flushAllAutosavers);
  window.addEventListener("beforeunload", flushAllAutosavers);
}

/**
 * Debounced, serialized saver: one request at a time, patches arriving mid-save are batched into the next one.
 * A failed save keeps its patch and retries after 2s, 5s and 15s.
 */
export function createAutosaver<P extends object>({ save, delayMs = AUTOSAVE_MS, onState }: Options<P>): Autosaver<P> {
  let pending: Partial<P> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let running: Promise<void> | null = null;
  let lastError: unknown = null;
  hookExit();

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    const wait = RETRY_MS[retries];
    if (wait === undefined || !pending) return;
    retries++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void drain();
    }, wait);
  };

  const drain = (): Promise<void> => {
    if (running) return running;
    clearRetry();
    running = (async () => {
      let failed = false;
      while (pending) {
        const patch = pending;
        pending = null;
        onState?.("saving");
        try {
          await save(patch);
          lastError = null;
          retries = 0;
          onState?.(pending ? "saving" : "saved");
        } catch (err) {
          lastError = err;
          pending = { ...patch, ...(pending ?? {}) };
          onState?.("error");
          failed = true;
          break;
        }
      }
      if (failed) scheduleRetry();
    })().finally(() => {
      running = null;
      if (!pending) unsaved.delete(saver);
    });
    return running;
  };

  const saver: Autosaver<P> = {
    push(part) {
      pending = { ...(pending ?? {}), ...part };
      unsaved.add(saver);
      retries = 0;
      clearRetry();
      clearTimer();
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delayMs);
    },
    async flush() {
      clearTimer();
      if (running) await running;
      if (pending) await drain();
      if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    },
    cancel() {
      clearTimer();
      clearRetry();
      pending = null;
      if (!running) unsaved.delete(saver);
    },
    hasPending: () => pending !== null || running !== null,
  };
  return saver;
}
