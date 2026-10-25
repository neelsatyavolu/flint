import { useMemo, useState } from "react";
import clsx from "clsx";
import type { MessageView } from "@flint/core";
import { flint } from "../../lib/api";
import { Button, MailFrame, Skeleton, useToast } from "../../ui";
import { splitQuoted } from "./quotedText";
import styles from "./Message.module.css";

function PlainBody({ text }: { text: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { body, quoted } = useMemo(() => splitQuoted(text), [text]);
  return (
    <div className={clsx("t-prose selectable", styles.prose)}>
      <div className={styles.pre}>{body}</div>
      {quoted ? (
        <>
          <button type="button" className={clsx("t-data", styles.quotePill)} aria-expanded={showQuoted} aria-label="Show quoted text" onClick={() => setShowQuoted((s) => !s)}>···</button>
          {showQuoted ? <div className={clsx(styles.pre, styles.quoted)}>{quoted}</div> : null}
        </>
      ) : null}
    </div>
  );
}

export function MessageBody({ message, onUpdated }: { message: MessageView; onUpdated: () => void }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const allowed = message.remoteImages === "allowed" || loaded;
  // core strips blocked images from the html, so its remoteImages flag is the only reliable signal.
  const blockedNotice = message.remoteImages === "blocked" && !loaded;

  const load = (always: boolean) =>
    void flint.allowRemoteImages(message.id, always).then(
      () => {
        setLoaded(true);
        onUpdated();
      },
      () => toast.show({ message: "Couldn't load images. Try again.", level: "error" }),
    );

  if (!message.bodyLoaded && message.html === null && message.text === null) {
    return (
      <div className={styles.skeleton} role="status" aria-label="Loading message">
        <Skeleton width="70%" /><Skeleton width="92%" /><Skeleton width="55%" />
      </div>
    );
  }

  return (
    <div className={styles.bodyWrap}>
      {blockedNotice ? (
        <div className={clsx("t-body", styles.notice)}>
          <span>Remote images are blocked.</span>
          <Button size="sm" variant="ghost" onClick={() => load(false)}>Load images</Button>
          <Button size="sm" variant="ghost" onClick={() => load(true)}>Always for this sender</Button>
        </div>
      ) : null}
      {message.hasTrackers ? <p className={clsx("t-body", styles.trackers)}>Flint removed tracking pixels from this message.</p> : null}
      {message.html !== null ? (
        <div className={styles.sheet}>
          <MailFrame html={message.html} allowRemoteImages={allowed} title={`Message from ${message.from[0]?.name || message.from[0]?.address || "sender"}`} />
        </div>
      ) : (
        <PlainBody text={message.text ?? ""} />
      )}
    </div>
  );
}
