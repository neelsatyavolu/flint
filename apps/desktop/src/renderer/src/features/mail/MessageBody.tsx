import { useMemo, useState } from "react";
import clsx from "clsx";
import { MoreHorizontal } from "lucide-react";
import type { MessageView } from "@flint/core";
import { flint } from "../../lib/api";
import { Button, MailFrame, Skeleton, useToast } from "../../ui";
import { useResolvedTheme } from "../../lib/theme";
import { useFrameGate } from "./frameGate";
import { useMailAppearance } from "./mailAppearance";
import { splitQuoted, splitQuotedHtml } from "./quotedText";
import styles from "./Message.module.css";

function PlainBody({ text }: { text: string }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { body, quoted } = useMemo(() => splitQuoted(text), [text]);
  return (
    <div className={clsx("selectable", styles.messageText, styles.prose)}>
      <div className={styles.pre}>{body}</div>
      {quoted ? (
        <>
          <QuotePill open={showQuoted} onClick={() => setShowQuoted((s) => !s)} />
          {showQuoted ? <div className={clsx(styles.pre, styles.quoted)}>{quoted}</div> : null}
        </>
      ) : null}
    </div>
  );
}

function QuotePill({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={styles.quotePill} aria-expanded={open} aria-label={open ? "Hide quoted text" : "Show quoted text"} onClick={onClick}>
      <MoreHorizontal size={14} strokeWidth={1.5} aria-hidden />
    </button>
  );
}

/** HTML mail: the newest text in one frame, quoted history in a second frame behind the pill. */
function HtmlBody({ html, subject, allowed, title, sheet }: { html: string; subject: string; allowed: boolean; title: string; sheet: "theme" | "light-sheet" }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const { body, quoted } = useMemo(() => splitQuotedHtml(html, subject), [html, subject]);
  const ready = useFrameGate();
  const cls = styles.sheet;
  // Themed mail sits flush with the avatar and header. The light sheet keeps its inset only on a dark card; on the
  // light theme the card is already white, so an inset would just indent the text.
  const theme = useResolvedTheme();
  const flush = sheet === "theme" || theme === "light" ? 0 : undefined;
  return (
    <>
      <div className={cls}><MailFrame html={body} allowRemoteImages={allowed} sheet={sheet} padding={flush} title={title} onReady={ready} /></div>
      {quoted !== null ? (
        <>
          <QuotePill open={showQuoted} onClick={() => setShowQuoted((s) => !s)} />
          {showQuoted ? <div className={clsx(cls, styles.quotedFrame)}><MailFrame html={quoted} allowRemoteImages={allowed} sheet={sheet} padding={flush} title={`${title}, earlier messages`} /></div> : null}
        </>
      ) : null}
    </>
  );
}

export function MessageBody({ message, onUpdated }: { message: MessageView; onUpdated: () => void }) {
  const toast = useToast();
  const appearance = useMailAppearance(message);
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
          <span>{message.hasTrackers ? "Remote images are blocked and tracking pixels removed." : "Remote images are blocked."}</span>
          <Button size="sm" variant="ghost" onClick={() => load(false)}>Load images</Button>
          <Button size="sm" variant="ghost" onClick={() => load(true)}>Always for this sender</Button>
        </div>
      ) : null}
      {message.hasTrackers && !blockedNotice ? <p className={clsx("t-body", styles.trackers)}>Flint removed tracking pixels from this message.</p> : null}
      {message.html !== null && appearance.html !== null ? (
        <HtmlBody html={appearance.html} subject={message.subject} allowed={allowed} sheet={appearance.sheet} title={`Message from ${message.from[0]?.name || message.from[0]?.address || "sender"}`} />
      ) : (
        <PlainBody text={message.text ?? ""} />
      )}
    </div>
  );
}
