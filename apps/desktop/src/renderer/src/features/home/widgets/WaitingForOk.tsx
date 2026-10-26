import { useState, type JSX } from "react";
import clsx from "clsx";
import type { ScheduledSend } from "@flint/core";
import { FlintError } from "@flint/core/types";
import { flint } from "../../../lib/api";
import { formatParticipants } from "../../../lib/format";
import { Button, useToast } from "../../../ui";
import { HomeBlock } from "../HomeBlock";
import styles from "../HomeView.module.css";

/** Sends an agent asked for that wait on the user's approval. Hidden when there are none. */
export function WaitingForOk({ scheduled, onStale }: { scheduled: readonly ScheduledSend[]; onStale: () => void }): JSX.Element | null {
  const toast = useToast();
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const waiting = scheduled.filter((s) => s.status === "awaiting_approval");
  if (!waiting.length) return null;

  const decide = async (s: ScheduledSend, approve: boolean) => {
    setBusy((b) => new Set(b).add(s.id));
    try {
      // Decided: the buttons stay off until the refreshed list drops the row.
      await flint.approveSend(s.id, approve);
    } catch (err) {
      // Already decided elsewhere (Agent Activity, the CLI), so not a failure: refresh to drop the row.
      if (err instanceof FlintError && err.code === "conflict") return onStale();
      toast.show({ message: approve ? "Couldn't send it. Try again." : "Couldn't cancel the send. Try again.", level: "error" });
      setBusy((b) => {
        const next = new Set(b);
        next.delete(s.id);
        return next;
      });
    }
  };

  return (
    <HomeBlock title="Waiting for your OK">
      {waiting.map((s) => {
        const to = formatParticipants(s.to, 2);
        return (
          <li key={s.id} className={styles.item}>
            <span className={styles.subject}>
              {s.subject || "(no subject)"}
              {to ? <span className={styles.to}> to {to}</span> : null}
            </span>
            <span className={clsx("t-data", styles.marker)}>{s.requestedBy}</span>
            <Button size="sm" variant="ghost" disabled={busy.has(s.id)} onClick={() => void decide(s, true)}>Send</Button>
            <Button size="sm" variant="ghost" disabled={busy.has(s.id)} onClick={() => void decide(s, false)}>Don't send</Button>
          </li>
        );
      })}
    </HomeBlock>
  );
}
