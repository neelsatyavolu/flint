import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
   * A deadline the toast counts down to, e.g. an undo-send window: the message is redrawn every second from `format`
   * and a bar drains until `until` (epoch ms). Pointer and focus do not hold it: the deadline is real.
   */
  countdown?: { until: number; format: (secondsLeft: number) => string };
  /**
   * Runs once when the toast goes without its action or secondary action being pressed: it timed out, was closed, or
   * newer toasts pushed it out. Lets a deferred change commit exactly when its Undo is no longer on screen.
   */
  onDismiss?: () => void;
};
type ToastItem = ToastInput & { id: number };
type ToastApi = { show: (t: ToastInput) => number; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Whole seconds until `until`, rounded up, redrawn as they tick; null without a deadline. */
function useSecondsLeft(until: number | undefined): number | null {
  const left = () => (until === undefined ? null : Math.max(0, Math.ceil((until - Date.now()) / 1000)));
  const [value, setValue] = useState(left);
  useEffect(() => {
    if (until === undefined) return;
    const t = setInterval(() => setValue(left()), 250);
    return () => clearInterval(t);
    // left only closes over until.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return value;
}
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
  const { countdown } = toast;
  const paused = !countdown && (hovered || focused);
  const timeout = countdown ? Math.max(0, countdown.until - Date.now()) : toast.timeout ?? DEFAULT_TIMEOUT;
  useEffect(() => {
    if (paused || (timeout === 0 && !countdown)) return;
    const t = setTimeout(() => onDismiss(toast.id), timeout);
    return () => clearTimeout(t);
    // timeout is read once per pause change: a countdown's deadline does not move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, toast.id, onDismiss]);
  const secondsLeft = useSecondsLeft(countdown?.until);
  // The bar starts at the share of the window still left (the toast can appear a beat after the send was queued).
  const [bar] = useState(() => (countdown && toast.timeout ? { from: Math.min(1, timeout / toast.timeout), ms: timeout } : countdown ? { from: 1, ms: timeout } : null));

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
      <span className={styles.message}>{countdown && secondsLeft !== null ? countdown.format(secondsLeft) : toast.message}</span>
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
      {bar ? <span className={styles.progress} style={{ "--from": bar.from, animationDuration: `${bar.ms}ms` } as CSSProperties} aria-hidden /> : null}
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
