import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import { flint } from "../lib/api";
import { useFlintEvent } from "../lib/hooks";
import styles from "./Toast.module.css";

export type ToastInput = {
  message: string;
  action?: { label: string; onClick: () => void };
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
  const [paused, setPaused] = useState(false);
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
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
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
        </>
      ) : null}
    </div>
  );
}

/** Bottom-centre toasts. Also turns main-process 'toast' events into toasts, wiring undoToken to "Undo". */
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
      action: token ? { label: "Undo", onClick: () => void flint.undo(token) } : undefined,
    });
  });

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.viewport} aria-live="polite">
        {toasts.map((t) => <ToastView key={t.id} toast={t} onDismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}
