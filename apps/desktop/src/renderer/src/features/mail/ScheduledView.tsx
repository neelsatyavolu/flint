import clsx from "clsx";
import type { ScheduledSend } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";
import { formatParticipants } from "../../lib/format";
import { formatPresetTime } from "../../lib/time";
import { Badge, Button, EmptyState, SkeletonRows, useToast } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import styles from "./ScheduledView.module.css";

function statusText(s: ScheduledSend): string {
  switch (s.status) {
    case "awaiting_approval": return "Waiting for your approval";
    case "failed": return s.error ?? "Failed to send";
    case "sending": return "Sending";
    default: return `Sends ${formatPresetTime(s.sendAt)}`;
  }
}

/** Mail queued to send later, or waiting for approval. Cancel returns a send to Drafts. */
export function ScheduledView() {
  const toast = useToast();
  const { data, loading, refetch } = useFlintQuery((api) => api.listScheduled(), [], { refetchOn: ["send"] });

  const cancel = (s: ScheduledSend) =>
    void flint.cancelSend(s.id).then(
      () => toast.show({ message: "Send cancelled. The draft is back in Drafts." }),
      () => toast.show({ message: "Couldn't cancel that send. It may already be on its way.", level: "error" }),
    ).finally(refetch);
  const decide = (s: ScheduledSend, approve: boolean) =>
    void flint.approveSend(s.id, approve).then(
      () => toast.show({ message: approve ? "Approved. The mail will send." : "Denied. Nothing was sent." }),
      () => toast.show({ message: "Couldn't update that send. Try again.", level: "error" }),
    ).finally(refetch);

  return (
    <div className={styles.view}>
      <PaneHeader title="Scheduled" subtitle="Mail waiting to send" />
      <div className={styles.scroll}>
        {!data && loading ? (
          <SkeletonRows count={4} density="compact" />
        ) : data && data.length === 0 ? (
          <EmptyState title="Nothing scheduled." description="Use send later in the composer to queue mail." markSize={48} />
        ) : (
          <ul className={styles.list}>
            {[...(data ?? [])].sort((a, b) => a.sendAt - b.sendAt).map((s) => (
              <li key={s.id} className={styles.row}>
                <div className={styles.main}>
                  <span className={styles.subject}>{s.subject || "(no subject)"}</span>
                  <span className={clsx("t-data", styles.meta)}>To {formatParticipants(s.to)} · {statusText(s)}{s.requestedBy && s.requestedBy !== "user" ? ` · requested by ${s.requestedBy}` : ""}</span>
                </div>
                <div className={styles.side}>
                  {s.status === "awaiting_approval" ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => decide(s, true)}>Approve</Button>
                      <Button size="sm" variant="ghost" onClick={() => decide(s, false)}>Deny</Button>
                    </>
                  ) : s.status === "failed" ? (
                    <Badge tone="danger">Failed</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => cancel(s)}>Cancel</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
