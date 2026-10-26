import type { JSX } from "react";
import { format } from "date-fns";
import clsx from "clsx";
import type { ScheduledSend, ThreadListItem } from "@flint/core";
import { navStore } from "../../../state/nav";
import { HomeBlock } from "../HomeBlock";
import { todayRows } from "./todayRows";
import styles from "../HomeView.module.css";

/** Snoozed mail coming back and sends going out later today. Hidden when nothing is due. */
export function Today({ snoozed, scheduled, now }: { snoozed: readonly ThreadListItem[]; scheduled: readonly ScheduledSend[]; now: number }): JSX.Element | null {
  const rows = todayRows(snoozed, scheduled, now);
  if (!rows.length) return null;
  return (
    <HomeBlock title="Today">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            className={styles.row}
            onClick={() => (r.kind === "back" ? navStore.getState().openThread(r.threadId, { fromOutside: true }) : navStore.getState().go({ view: "scheduled" }))}
          >
            <span className={clsx("t-data", styles.when)}>{format(r.at, "h:mm a")}</span>
            <span className={clsx("t-data", styles.kind)}>{r.kind === "back" ? "Back" : "Sends"}</span>
            <span className={styles.subject}>
              {r.subject || "(no subject)"}
              {r.kind === "sends" && r.to ? <span className={styles.to}> to {r.to}</span> : null}
            </span>
          </button>
        </li>
      ))}
    </HomeBlock>
  );
}
