import type { JSX } from "react";
import clsx from "clsx";
import { useFlintQuery } from "../../../lib/hooks";
import { formatAgo, formatParticipants } from "../../../lib/format";
import { Avatar } from "../../../ui";
import { openComposer } from "../../compose/composerStore";
import { HomeBlock } from "../HomeBlock";
import styles from "../HomeView.module.css";

const SHOWN = 3;

/** The three most recently edited drafts; a row reopens it in the composer. Hidden when there are none. */
export function RecentDrafts({ now }: { now: number }): JSX.Element | null {
  const { data } = useFlintQuery((api) => api.listDrafts(), []);
  const drafts = [...(data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, SHOWN);
  if (!drafts.length) return null;
  return (
    <HomeBlock title="Drafts">
      {drafts.map((d) => {
        const to = formatParticipants(d.to, 2);
        const lead = d.to[0];
        return (
          <li key={d.id}>
            <button type="button" className={styles.row} onClick={() => openComposer({ draftId: d.id })}>
              {lead ? <Avatar address={lead.address} name={lead.name} size={24} /> : <span className={styles.noAvatar} aria-hidden />}
              <span className={clsx(styles.who, !to && styles.none)}>{to ? `to ${to}` : "No recipients"}</span>
              <span className={styles.subject}>{d.subject || "(no subject)"}</span>
              <span className={clsx("t-data", styles.ago)}>{formatAgo(d.updatedAt, now)}</span>
            </button>
          </li>
        );
      })}
    </HomeBlock>
  );
}
