import { useState } from "react";
import { ChevronRight, Eye, RefreshCw } from "lucide-react";
import clsx from "clsx";
import type { ReceiptDetail, TrackedMessage } from "@flint/core";
import { flint } from "../../lib/api";
import { useFlintQuery } from "../../lib/hooks";
import { formatListTime } from "../../lib/format";
import { EmptyState, IconButton, SegmentedControl, SkeletonRows, useToast } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { navStore } from "../../state/nav";
import { eventLine, receiptMarker, receiptTime } from "../../state/receiptText";
import { RecipientRows } from "./RecipientRows";
import styles from "./ReceiptsView.module.css";

type Filter = "all" | "opened" | "unopened";
const FILTERS = [
  { value: "all" as const, label: "All" },
  { value: "opened" as const, label: "Opened" },
  { value: "unopened" as const, label: "Not opened" },
];

function Timeline({ data }: { data: ReceiptDetail | undefined }) {
  if (!data) return <p className={clsx("t-data", styles.muted)}>Loading events</p>;
  if (data.events.length === 0) return <p className={clsx("t-data", styles.muted)}>No events yet.</p>;
  return (
    <ol className={styles.timeline}>
      {[...data.events].sort((a, b) => b.at - a.at).map((ev, i) => (
        <li key={`${ev.at}-${i}`} className={clsx("t-data", styles.event, !ev.counted && styles.muted)}>
          <span className={styles.eventTime}>{receiptTime(ev.at)}</span>
          <span>{ev.email} · {eventLine(ev)}</span>
        </li>
      ))}
    </ol>
  );
}

function TrackedRow({ item, now }: { item: TrackedMessage; now: number }) {
  const [open, setOpen] = useState(false);
  const marker = receiptMarker(item.summary);
  const detail = useFlintQuery((api) => api.getReceipt(item.trackedId), [item.trackedId], { refetchOn: ["receipt"], enabled: open }).data ?? null;
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <button type="button" className={styles.chevron} aria-expanded={open} aria-label={open ? "Hide timeline" : "Show timeline"} onClick={() => setOpen((o) => !o)}>
          <ChevronRight size={14} strokeWidth={1.5} className={clsx(open && styles.turned)} />
        </button>
        <button
          type="button"
          className={styles.subject}
          disabled={item.threadId === null}
          onClick={() => item.threadId !== null && navStore.getState().openThread(item.threadId, { fromOutside: true })}
        >
          {item.subject || "(no subject)"}
        </button>
        <span className={clsx("t-data", styles.marker, marker.tone === "ok" && styles.ok)}><Eye size={12} strokeWidth={1.5} />{marker.text}</span>
        <span className={clsx("t-data", styles.time)}>{formatListTime(item.sentAt, now)}</span>
      </div>
      <div className={styles.recipients}>
        <RecipientRows recipients={item.recipients} detail={detail} />
      </div>
      {open ? <div className={styles.timelineWrap}><Timeline data={detail ?? undefined} /></div> : null}
    </li>
  );
}

/** Read Statuses: tracked sent mail with per-recipient status. */
export function ReceiptsView() {
  const [filter, setFilter] = useState<Filter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const toast = useToast();
  const { data, loading, refetch } = useFlintQuery((api) => api.listTracked({ limit: 100, status: filter === "all" ? undefined : filter }), [filter], { refetchOn: ["receipt"] });
  const now = Date.now();

  const refresh = async () => {
    setRefreshing(true);
    try {
      await flint.refreshReceipts();
      refetch();
    } catch {
      toast.show({ message: "Couldn't reach the receipts service. Try again.", level: "error" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className={styles.view}>
      <PaneHeader title="Read Statuses" subtitle="Tracked mail you sent">
        <SegmentedControl label="Filter" options={FILTERS} value={filter} onChange={setFilter} />
        <IconButton label="Refresh" onClick={() => void refresh()}><RefreshCw size={16} strokeWidth={1.5} className={clsx(refreshing && styles.spin)} /></IconButton>
      </PaneHeader>
      <div className={styles.scroll}>
        {!data && loading ? (
          <SkeletonRows count={6} />
        ) : data && data.length === 0 ? (
          <EmptyState
            title={filter === "all" ? "No tracked mail yet." : filter === "opened" ? "Nothing opened yet." : "Everything has been opened."}
            description={filter === "all" ? "Turn on the eye in the composer to see who opens your mail." : undefined}
            markSize={48}
          />
        ) : (
          <ul className={styles.list}>{data?.map((t) => <TrackedRow key={t.trackedId} item={t} now={now} />)}</ul>
        )}
      </div>
    </div>
  );
}
