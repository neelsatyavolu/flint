import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { flint } from "../lib/api";
import { useFlintEvent } from "../lib/hooks";
import { IconButton } from "./IconButton";
import styles from "./Toast.module.css";

export type ToastInput = {
  message: string;
  action?: { label: string; onClick: () => void };
  /** A second button after `action`, e.g. "Always for this sender" next to "Undo". */
  secondaryAction?: { label: string; onClick: () => void };
  /** Milliseconds before it dismisses itself. Default 5000. 0 keeps it until dismissed. */
  timeout?: number;
  level?: "info" | "error";
  /**
   * Runs once when the toast goes without its action or secondary action being pressed: it timed out, was closed, or
   * newer toasts pushed it out. Lets a deferred change commit exactly when its Undo is no longer on screen.
   */
  onDismiss?: () => void;
};
type ToastItem = ToastInput & { id: number };
type ToastApi = { show: (t: ToastInput) => number; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);
const MAX_VISIBLE = 3;
const DEFAULT_TIMEOUT = 5000;

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast needs a ToastProvider");
  return ctx;
}

function ToastView({ toast, onDismiss, onAct }: { toast: ToastItem; onDismiss: (id: number) => void; onAct: (id: number) => void }) {
  // The timer waits while the pointer is over the toast or focus is inside it, so it can't vanish mid-read or mid-Tab.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const timeout = toast.timeout ?? DEFAULT_TIMEOUT;
  useEffect(() => {
    if (paused || timeout === 0) return;
    const t = setTimeout(() => onDismiss(toast.id), timeout);
    return () => clearTimeout(t);
  }, [paused, timeout, toast.id, onDismiss]);

  return (
    <div
      className={clsx(styles.toast, toast.level === "error" && styles.error)}
      role={toast.level === "error" ? "alert" : "status"}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <span className={styles.message}>{toast.message}</span>
      {toast.action ? (
        <>
          <span className={styles.dot} aria-hidden>·</span>
          <button
            type="button"
            className={styles.action}
            onClick={() => {
              onAct(toast.id);
              toast.action?.onClick();
            }}
          >
            {toast.action.label}
          </button>
          {toast.secondaryAction ? (
            <>
              <span className={styles.dot} aria-hidden>·</span>
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  onAct(toast.id);
                  toast.secondaryAction?.onClick();
                }}
              >
                {toast.secondaryAction.label}
              </button>
            </>
          ) : null}
        </>
      ) : null}
      <IconButton label="Dismiss" size={24} className={styles.close} onClick={() => onDismiss(toast.id)}>
        <X size={14} strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}

/** Bottom-right toasts, above the Ask field. Also turns main-process 'toast' events into toasts, wiring undoToken to "Undo". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // The list as of the last change, so onDismiss runs outside a state updater, once per toast.
  const live = useRef<ToastItem[]>([]);
  const nextId = useRef(1);

  const replace = useCallback((next: ToastItem[]) => {
    live.current = next;
    setToasts(next);
  }, []);
  /** Removes a toast whose button was pressed: its onDismiss does not run. */
  const act = useCallback((id: number) => replace(live.current.filter((t) => t.id !== id)), [replace]);
  const dismiss = useCallback((id: number) => {
    const gone = live.current.find((t) => t.id === id);
    if (!gone) return;
    replace(live.current.filter((t) => t.id !== id));
    gone.onDismiss?.();
  }, [replace]);
  const show = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    const all = [...live.current, { ...t, id }];
    const kept = all.slice(-MAX_VISIBLE);
    replace(kept);
    for (const pushed of all.slice(0, all.length - kept.length)) pushed.onDismiss?.();
    return id;
  }, [replace]);

  useFlintEvent("toast", (e) => {
    const token = e.undoToken;
    show({
      message: e.message,
      level: e.level,
      // Errors from the core (a send or an action the server refused) stay until read and closed.
      ...(e.level === "error" ? { timeout: 0 } : {}),
      action: token ? { label: "Undo", onClick: () => void flint.undo(token) } : undefined,
    });
  });

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  // No aria-live here: each toast's own status or alert role announces it, once.
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.viewport}>
        {toasts.map((t) => <ToastView key={t.id} toast={t} onDismiss={dismiss} onAct={act} />)}
      </div>
    </ToastContext.Provider>
  );
}
