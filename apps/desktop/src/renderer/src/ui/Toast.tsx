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

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
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
              toast.action?.onClick();
              onDismiss(toast.id);
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
                  toast.secondaryAction?.onClick();
                  onDismiss(toast.id);
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
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback((t: ToastInput) => {
    const id = nextId.current++;
    setToasts((list) => [...list, { ...t, id }].slice(-MAX_VISIBLE));
    return id;
  }, []);

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
        {toasts.map((t) => <ToastView key={t.id} toast={t} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}
