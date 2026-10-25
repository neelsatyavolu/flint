import { useEffect, useState } from "react";
import clsx from "clsx";
import type { Draft } from "@flint/core";
import { flint } from "../../lib/api";
import { displayName } from "../../lib/format";
import { Avatar, Button, useToast } from "../../ui";
import { useInlineReply } from "../../state/inlineReply";
import { useFrameGate } from "./frameGate";
import styles from "./Message.module.css";

/** Plain text of draft HTML for the card preview. Never injects the HTML itself. */
export function draftPreviewText(html: string): string {
  const spaced = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const text = typeof DOMParser === "undefined" ? spaced.replace(/<[^>]+>/g, "") : (new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? "");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

type Props = { draftId: number; threadId: number; messageId: number | null; reloadKey: number; onChanged: () => void };

/** A saved reply shown in the thread: DRAFT tag, "to Name", and Delete / Edit / Send. */
export function DraftCard({ draftId, threadId, messageId, reloadKey, onChanged }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  // The thread is not shown until this card knows its height, so it never pops in under a reader that is already visible.
  const sized = useFrameGate();

  useEffect(() => {
    let live = true;
    void flint.getDraft(draftId).then(
      (d) => {
        if (!live) return;
        setDraft(d);
        sized();
      },
      () => {
        if (!live) return;
        setDraft(null);
        sized();
      },
    );
    return () => {
      live = false;
    };
    // sized is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, reloadKey]);

  if (!draft) return null;
  const first = draft.to[0];
  const extra = draft.to.length - 1;
  const text = draftPreviewText(draft.html);

  const remove = () => {
    setBusy(true);
    void flint.deleteDraft(draftId).then(onChanged, () => {
      setBusy(false);
      toast.show({ message: "Couldn't delete the draft. Try again.", level: "error" });
    });
  };
  const send = () => {
    setBusy(true);
    void flint.sendDraft(draftId).then(
      () => {
        toast.show({ message: "Sending your reply" });
        onChanged();
      },
      () => {
        setBusy(false);
        toast.show({ message: "Couldn't send the draft. Check the recipients and try again.", level: "error" });
      },
    );
  };
  const edit = () => {
    const mode = draft.mode === "new" ? "reply" : draft.mode;
    useInlineReply.getState().open({ threadId, messageId: draft.sourceMessageId ?? messageId ?? 0, mode, draftId });
  };

  return (
    <article className={clsx(styles.card, styles.draft)} aria-label="Draft reply">
      <header className={styles.draftHead}>
        <Avatar address={draft.from} accountId={draft.accountId} size={32} />
        <span className={clsx("t-data", styles.draftTag)}>DRAFT</span>
        {first ? (
          <span className={clsx("t-body", styles.draftTo)}>
            <span className={styles.toWord}>to</span> <span className={styles.toAccent}>{displayName(first)}{extra > 0 ? ` +${extra}` : ""}</span>
          </span>
        ) : (
          <span className={clsx("t-body", styles.toPlain)}>no recipient yet</span>
        )}
        <span className={styles.grow} />
        <div className={styles.draftActions}>
          <Button size="sm" variant="ghost" className={styles.draftDelete} onClick={remove} disabled={busy}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={edit} disabled={busy}>Edit</Button>
          <span className={styles.draftDivider} aria-hidden />
          <Button size="sm" variant="primary" onClick={send} disabled={busy || draft.to.length === 0}>Send</Button>
        </div>
      </header>
      {text ? <div className={clsx("selectable", styles.pre, styles.messageText, styles.draftText)}>{text}</div> : <div className={clsx("t-body", styles.toPlain)}>Empty draft</div>}
    </article>
  );
}
