import type { JSX } from "react";
import clsx from "clsx";
import { useFlintQuery } from "../../lib/hooks";
import { formatListTime } from "../../lib/format";
import { Avatar } from "../../ui";
import { navStore } from "../../state/nav";
import { useAiAvailability } from "../ai/useAiRun";
import { parseNeedsReply, REASON_LABEL } from "./replyRows";
import { HomeBlock } from "./HomeBlock";
import styles from "./HomeView.module.css";

/** People threads where someone asked something and nobody has answered. Found locally; hidden when +AI is off. */
export function NeedsReply({ now }: { now: number }): JSX.Element | null {
  const ai = useAiAvailability();
  const q = useFlintQuery(async (api) => parseNeedsReply((await api.aiRunToText({ kind: "needsReply" })).text), [], { enabled: ai.enabled });
  const rows = q.data ?? [];
  if (!ai.enabled || rows.length === 0) return null;
  return (
    <HomeBlock title="Needs reply">
      {rows.map((r) => (
        <li key={r.threadId}>
          <button type="button" className={styles.row} onClick={() => navStore.getState().openThread(r.threadId, { fromOutside: true })}>
            <Avatar address={r.from.address} name={r.from.name} size={24} />
            <span className={clsx(styles.who, r.unreadCount > 0 && styles.unread)}>{r.from.name || r.from.address}</span>
            <span className={styles.subject}>{r.subject || "(no subject)"}</span>
            <span className={clsx("t-data", styles.marker)}>{REASON_LABEL[r.reason]}</span>
            <span className={clsx("t-data", styles.time)}>{formatListTime(r.date, now)}</span>
          </button>
        </li>
      ))}
    </HomeBlock>
  );
}
