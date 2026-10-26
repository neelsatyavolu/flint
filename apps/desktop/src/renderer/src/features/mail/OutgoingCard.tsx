import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Draft, OutgoingSend } from "@flint/core";
import { flint } from "../../lib/api";
import { displayName } from "../../lib/format";
import { formatPresetTime } from "../../lib/time";
import { Avatar, Button, useToast } from "../../ui";
import { useInlineReply } from "../../state/inlineReply";
import { forgetSend } from "../compose/useSendFlow";
import { sendingIn } from "../compose/sendToast";
import { draftPreviewText } from "./DraftCard";
import styles from "./Message.module.css";

/** A send that already went out but whose Sent copy has not synced into the thread yet. */
export type Departed = OutgoingSend & { goneAt: number };

/** What the card's status says: a countdown inside the undo window, the send-later time, or where the send is. */
export function outgoingStatus(send: OutgoingSend, now: number, departed: boolean): string {
  if (departed) return "Sent";
  if (send.status === "awaiting_approval") return "Waiting for approval";
  if (send.status === "sending" || send.sendAt <= now) return "Sending…";
  const ms = send.sendAt - now;
  return ms <= 90_000 ? sendingIn(Math.ceil(ms / 1000)) : `Scheduled for ${formatPresetTime(send.sendAt, now)}`;
}

function useNow(live: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [live]);
  return now;
}

type Props = { send: OutgoingSend; departed: boolean; threadId: number; messageId: number | null; onChanged: () => void };

/** A reply on its way, at the end of the thread: "to Name", its status and Undo, until the real message arrives. */
export function OutgoingCard({ send, departed, threadId, messageId, onChanged }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(!departed);

  // The draft is read once: after the send it is deleted, and the card keeps what it showed.
  useEffect(() => {
    let live = true;
    void flint.getDraft(send.draftId).then((d) => live && setDraft(d), () => undefined);
    return () => {
      live = false;
    };
  }, [send.draftId]);

  if (!draft) return null;
  const first = draft.to[0];
  const extra = draft.to.length + draft.cc.length - 1;
  const text = draftPreviewText(draft.html);
  const undoable = !departed && send.status !== "sending" && send.sendAt > now;

  const undo = () => {
    setBusy(true);
    void flint.cancelSend(send.scheduledId).then(
      (d) => {
        forgetSend(send.scheduledId);
        onChanged();
        const mode = d.mode === "new" ? "reply" : d.mode;
        useInlineReply.getState().open({ threadId, messageId: d.sourceMessageId ?? messageId ?? 0, mode, draftId: d.id });
      },
      () => {
        setBusy(false);
        toast.show({ message: "Too late to undo. The message is on its way.", level: "error" });
      },
    );
  };

  return (
    <article className={clsx(styles.card, styles.draft, styles.outgoing)} aria-label="Reply being sent" aria-busy={!departed || undefined}>
      <header className={styles.draftHead}>
        <Avatar address={draft.from} accountId={draft.accountId} size={32} />
        <span className={clsx("t-body", styles.draftTo)}>
          <span className={styles.toWord}>me to</span> <span className={styles.toAccent}>{first ? displayName(first) : "no one"}{extra > 0 ? ` +${extra}` : ""}</span>
        </span>
        <span className={styles.grow} />
        <span className={clsx("t-data", styles.outgoingStatus)} role="status">{outgoingStatus(send, now, departed)}</span>
        {undoable ? <Button size="sm" variant="ghost" onClick={undo} disabled={busy}>Undo</Button> : null}
      </header>
      {text ? <div className={clsx("selectable", styles.pre, styles.messageText, styles.draftText)}>{text}</div> : null}
    </article>
  );
}
