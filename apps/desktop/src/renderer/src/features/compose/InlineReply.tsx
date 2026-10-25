import { lazy, Suspense, useEffect, useState, type JSX } from "react";
import type { Address } from "@flint/core";
import { firstName } from "../../lib/format";
import { useFlintQuery } from "../../lib/hooks";
import styles from "./InlineReply.module.css";

const loadEditor = () => import("./InlineReplyEditor").then((m) => ({ default: m.InlineReplyEditor }));
const Editor = lazy(loadEditor);

type Props = {
  threadId: number;
  messageId: number;
  mode?: "reply" | "replyAll";
  /** Sender of the message being answered. When omitted the name is fetched. */
  from?: Address;
  /** Quick-reply text to start the reply with. Setting it expands the field. */
  seedText?: string;
};

/** One-line "Reply to Cindy…" field that expands into a compact composer. The editor chunk loads on hover, focus or click. */
export function InlineReply({ threadId, messageId, mode = "reply", from, seedText }: Props): JSX.Element {
  const [open, setOpen] = useState(false);
  const message = useFlintQuery((api) => api.getMessage(messageId), [messageId], { enabled: from === undefined, mail: false });
  const sender = from ?? message.data?.from[0];
  const name = sender ? firstName(sender) : "";

  useEffect(() => setOpen(false), [messageId, threadId]);
  useEffect(() => {
    if (seedText) setOpen(true);
  }, [seedText]);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.collapsed}
        onClick={() => setOpen(true)}
        onPointerEnter={() => void loadEditor()}
        onFocus={() => void loadEditor()}
        aria-label={name ? `Reply to ${name}` : "Reply"}
      >
        {name ? `Reply to ${name}…` : "Reply…"}
      </button>
    );
  }
  return (
    <Suspense fallback={<div className={styles.open} aria-busy="true" />}>
      <Editor key={`${messageId}:${mode}`} messageId={messageId} mode={mode} seedText={seedText} onDone={() => setOpen(false)} />
    </Suspense>
  );
}
