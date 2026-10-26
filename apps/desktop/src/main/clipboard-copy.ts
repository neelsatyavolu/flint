/** The part of Electron's clipboard the copier uses, so tests can stand in for it. */
export interface ClipboardLike {
  readText(): string | Promise<string>;
  writeText(text: string): void | Promise<void>;
}

export type ClipboardCopierDeps = {
  clipboard: ClipboardLike;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (timer: unknown) => void;
};

/**
 * Copies text and, after `clearAfterMs`, empties the clipboard only if it still holds exactly that text, so something the
 * user copied since is never wiped. A newer copy cancels the earlier timer.
 */
export function createClipboardCopier(deps: ClipboardCopierDeps): (text: string, clearAfterMs: number) => void {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let pending: { unref?: () => void } | null = null;
  return (text, clearAfterMs) => {
    void Promise.resolve(deps.clipboard.writeText(text)).catch(() => {});
    if (pending) clearTimer(pending);
    const timer = setTimer(() => {
      if (pending === timer) pending = null;
      void (async () => {
        try {
          if ((await deps.clipboard.readText()) === text) await deps.clipboard.writeText("");
        } catch { /* the clipboard is unavailable; nothing to clear */ }
      })();
    }, clearAfterMs);
    timer.unref?.();
    pending = timer;
  };
}
