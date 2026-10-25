import { useMemo, type JSX } from "react";
import { Paperclip } from "lucide-react";
import clsx from "clsx";
import type { Address, AgentActivity, Draft } from "@flint/core";
import { formatAddress, formatFileSize } from "../../lib/format";
import { useFlintQuery } from "../../lib/hooks";
import { htmlToText } from "../../lib/html";
import { Button, Skeleton } from "../../ui";
import styles from "./ApprovalCard.module.css";

const PREVIEW_CHARS = 700;

type Props = {
  item: AgentActivity;
  /** The draft behind the queued send; null when the send can't be found, undefined while that is loading. */
  draftId: number | null | undefined;
  onDecide: (approve: boolean) => void;
};

function Recipients({ label, list }: { label: string; list: Address[] }): JSX.Element | null {
  if (list.length === 0) return null;
  return (
    <div className={styles.field}>
      <dt className="t-label">{label}</dt>
      <dd className={styles.value}>{list.map(formatAddress).join(", ")}</dd>
    </div>
  );
}

function Preview({ draft }: { draft: Draft }): JSX.Element {
  const text = useMemo(() => htmlToText(draft.html), [draft.html]);
  const cut = text.length > PREVIEW_CHARS;
  return (
    <>
      <Recipients label="To" list={draft.to} />
      <Recipients label="Cc" list={draft.cc} />
      <Recipients label="Bcc" list={draft.bcc} />
      <div className={styles.field}>
        <dt className="t-label">Subject</dt>
        <dd className={clsx(styles.value, styles.subject)}>{draft.subject || "(no subject)"}</dd>
      </div>
      <div className={clsx("t-prose selectable", styles.body)}>{text ? (cut ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text) : "The message has no text."}</div>
      {draft.attachments.length > 0 ? (
        <ul className={styles.files} aria-label="Attachments">
          {draft.attachments.map((a) => (
            <li key={a.id} className={clsx("t-data", styles.file)}>
              <Paperclip size={12} strokeWidth={1.5} aria-hidden />
              <span className={styles.fileName}>{a.filename}</span>
              <span className={styles.fileSize}>{formatFileSize(a.size)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** A queued agent send, shown in full so it can be approved or denied without opening Drafts. */
export function ApprovalCard({ item, draftId, onDecide }: Props): JSX.Element {
  const draft = useFlintQuery((api) => api.getDraft(draftId as number), [draftId], { enabled: typeof draftId === "number", mail: false });
  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.summary}>{item.summary}</span>
        <span className={clsx("t-data", styles.meta)}>{item.agent} · {item.method}</span>
      </div>
      <dl className={styles.fields}>
        {draft.data ? (
          <Preview draft={draft.data} />
        ) : draft.error || draftId === null ? (
          <p className={styles.missing}>The draft behind this send could not be loaded. Check Scheduled before approving.</p>
        ) : (
          <div role="status" aria-label="Loading the message"><Skeleton width="60%" /><div style={{ height: 8 }} /><Skeleton width="85%" /></div>
        )}
      </dl>
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" onClick={() => onDecide(true)}>Approve</Button>
        <Button size="sm" variant="ghost" onClick={() => onDecide(false)}>Deny</Button>
      </div>
    </div>
  );
}
