import type { JSX } from "react";
import type { SidebarData } from "@flint/core";
import { navStore, type NavView } from "../../../state/nav";
import styles from "../HomeView.module.css";

type Stat = { view: NavView; label: string; count: number; always?: boolean };

export function glanceStats(counts: SidebarData["counts"]): Stat[] {
  const all: Stat[] = [
    { view: "inbox", label: "Inbox", count: counts.inbox, always: true },
    { view: "pinned", label: "Pinned", count: counts.pinned },
    { view: "snoozed", label: "Snoozed", count: counts.snoozed },
    { view: "scheduled", label: "Scheduled", count: counts.scheduled },
    { view: "drafts", label: "Drafts", count: counts.drafts },
  ];
  return all.filter((s) => s.always || s.count > 0);
}

/** One line of counts under the hero ("INBOX 23 · SNOOZED 3"); each opens its view. */
export function Glance({ counts }: { counts: SidebarData["counts"] }): JSX.Element {
  return (
    <nav className={styles.glance} aria-label="At a glance">
      {glanceStats(counts).map((s) => (
        <button key={s.view} type="button" className={styles.stat} onClick={() => navStore.getState().go({ view: s.view })}>
          <span className="t-label">{s.label}</span>
          <span className="t-data">{s.count}</span>
        </button>
      ))}
    </nav>
  );
}
