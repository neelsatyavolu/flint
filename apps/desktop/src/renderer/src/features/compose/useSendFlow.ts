import { useCallback, useState } from "react";
import { flint } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import { openComposer } from "./composerStore";
import { describeSend } from "./sendToast";
import { checkSend } from "./validate";
import type { useComposerSession } from "./useComposerSession";

type Session = ReturnType<typeof useComposerSession>;

export const NO_RECIPIENTS = "Add at least one recipient.";

/** Send, validation and the undo toast, shared by the full composer and the inline reply. */
export function useSendFlow(session: Session, onSent: () => void) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmSubject, setConfirmSubject] = useState<{ sendAt?: number } | null>(null);

  const deliver = useCallback(
    async (opts?: { sendAt?: number }) => {
      setSending(true);
      const outcome = await session.send(opts);
      setSending(false);
      if (!outcome.ok) {
        setProblem(outcome.message);
        return;
      }
      onSent();
      const info = describeSend(outcome.result, Date.now(), outcome.scheduledFor);
      toast.show({
        message: info.message,
        timeout: info.timeoutMs,
        action: info.undoable
          ? {
              label: "Undo",
              onClick: () => {
                flint.cancelSend(outcome.result.scheduledId).then(
                  (draft) => openComposer({ draftId: draft.id }),
                  () => toast.show({ message: "Too late to undo. The message is on its way.", level: "error" }),
                );
              },
            }
          : undefined,
      });
    },
    [onSent, session, toast],
  );

  /** Waits a tick so a half-typed recipient commits first, then validates and sends. */
  const attempt = useCallback(
    async (opts?: { sendAt?: number }, skipSubjectCheck = false) => {
      await new Promise((r) => setTimeout(r, 0));
      const f = session.getFields();
      if (!f || sending) return;
      const check = checkSend(f);
      if (check === "no_recipients") return setProblem(NO_RECIPIENTS);
      if (check === "no_subject" && !skipSubjectCheck) return setConfirmSubject(opts ?? {});
      setProblem(null);
      await deliver(opts);
    },
    [deliver, sending, session],
  );

  return { attempt, sending, problem, clearProblem: () => setProblem(null), confirmSubject, dismissConfirm: () => setConfirmSubject(null) };
}
