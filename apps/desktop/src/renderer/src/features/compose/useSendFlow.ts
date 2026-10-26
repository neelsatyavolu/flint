import { useCallback, useState } from "react";
import { flint } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import { openComposer } from "./composerStore";
import { describeSend, isUndoSendKey, undoSendLabel } from "./sendToast";
import { checkSend, type SoftStop } from "./validate";
import type { useComposerSession } from "./useComposerSession";

type Session = ReturnType<typeof useComposerSession>;
type SendOpts = { sendAt?: number };

/** A soft stop waiting for the user: which one, the send it interrupted, and the stops already confirmed. */
export type PendingConfirm = { stop: SoftStop; opts?: SendOpts; skip: SoftStop[] };

export const NO_RECIPIENTS = "Add at least one recipient.";
export const NO_ATTACHMENT = { title: "Send without an attachment?", body: "You mentioned an attachment, but nothing is attached." };

type ToastApi = ReturnType<typeof useToast>;

type ArmedUndo = { toast: ToastApi; toastId: number; undo: () => void; timer: ReturnType<typeof setTimeout> };

/** Sends still inside their undo window, oldest first. The keyboard undoes the newest. */
const armed: ArmedUndo[] = [];

function disarm(entry: ArmedUndo): void {
  clearTimeout(entry.timer);
  const i = armed.indexOf(entry);
  if (i >= 0) armed.splice(i, 1);
  if (armed.length === 0) window.removeEventListener("keydown", onUndoKey, true);
}

function onUndoKey(e: KeyboardEvent): void {
  const last = armed.at(-1);
  if (!last || !isUndoSendKey(e)) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  disarm(last);
  last.toast.dismiss(last.toastId);
  last.undo();
}

/**
 * While the undo window is open, mod+z (or mod+shift+z) cancels the send. The listener captures on window and stops
 * the event, so the app-wide undo doesn't also run. It outlives the composer, which closes as soon as it sends.
 * Returns a function that disarms it early.
 */
function armUndoKey(toast: ToastApi, toastId: number, windowMs: number, undo: () => void): () => void {
  const entry: ArmedUndo = { toast, toastId, undo, timer: setTimeout(() => disarm(entry), windowMs) };
  armed.push(entry);
  if (armed.length === 1) window.addEventListener("keydown", onUndoKey, true);
  return () => disarm(entry);
}

/** Send, validation and the undo toast, shared by the full composer and the inline reply. */
export function useSendFlow(session: Session, onSent: () => void) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const deliver = useCallback(
    async (opts?: SendOpts) => {
      setSending(true);
      const outcome = await session.send(opts);
      setSending(false);
      if (!outcome.ok) {
        setProblem(outcome.message);
        return;
      }
      onSent();
      const info = describeSend(outcome.result, Date.now(), outcome.scheduledFor);
      const undo = () => {
        flint.cancelSend(outcome.result.scheduledId).then(
          (draft) => openComposer({ draftId: draft.id }),
          () => toast.show({ message: "Too late to undo. The message is on its way.", level: "error" }),
        );
      };
      let disarm: () => void = () => undefined;
      const id = toast.show({
        message: info.message,
        timeout: info.timeoutMs,
        action: info.undoable ? { label: undoSendLabel(), onClick: () => { disarm(); undo(); } } : undefined,
      });
      if (info.undoable) disarm = armUndoKey(toast, id, info.timeoutMs, undo);
    },
    [onSent, session, toast],
  );

  /** Waits a tick so a half-typed recipient commits first, then validates and sends. `skip` lists soft stops already confirmed. */
  const attempt = useCallback(
    async (opts?: SendOpts, skip: SoftStop[] = []) => {
      await new Promise((r) => setTimeout(r, 0));
      const f = session.getFields();
      if (!f || sending) return;
      const check = checkSend(f, skip);
      if (check === "no_recipients") return setProblem(NO_RECIPIENTS);
      if (check !== "ok") return setConfirm({ stop: check, opts, skip });
      setProblem(null);
      await deliver(opts);
    },
    [deliver, sending, session],
  );

  /** "Send anyway" from the confirm dialog: retries the interrupted send with this stop confirmed. */
  const confirmSend = useCallback(() => {
    if (!confirm) return;
    setConfirm(null);
    void attempt(confirm.opts, [...confirm.skip, confirm.stop]);
  }, [attempt, confirm]);

  return { attempt, sending, problem, clearProblem: () => setProblem(null), confirm, confirmSend, dismissConfirm: () => setConfirm(null) };
}
