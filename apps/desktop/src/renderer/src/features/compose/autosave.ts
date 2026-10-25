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

/** Debounced, serialized saver: one request at a time, patches arriving mid-save are batched into the next one. */
export function createAutosaver<P extends object>({ save, delayMs = AUTOSAVE_MS, onState }: Options<P>): Autosaver<P> {
  let pending: Partial<P> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  let lastError: unknown = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const drain = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (pending) {
        const patch = pending;
        pending = null;
        onState?.("saving");
        try {
          await save(patch);
          lastError = null;
          onState?.(pending ? "saving" : "saved");
        } catch (err) {
          lastError = err;
          pending = { ...patch, ...(pending ?? {}) };
          onState?.("error");
          break;
        }
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    push(part) {
      pending = { ...(pending ?? {}), ...part };
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
      pending = null;
    },
    hasPending: () => pending !== null || running !== null,
  };
}
