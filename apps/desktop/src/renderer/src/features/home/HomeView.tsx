import type { ReactNode } from "react";
import { format } from "date-fns";
import { Eye, Paperclip } from "lucide-react";
import clsx from "clsx";
import type { ThreadListItem, TrackedMessage } from "@flint/core";
import { useFlintQuery } from "../../lib/hooks";
import { formatListTime, formatParticipants, pluralize } from "../../lib/format";
import { Avatar, Skeleton } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { navStore } from "../../state/nav";
import { rowAvatar } from "../mail/rowText";
import { receiptMarker } from "../../state/receiptText";
import { greeting } from "./greeting";
import { CatchMeUp } from "./CatchMeUp";
import { HomeBlock } from "./HomeBlock";
import { NeedsReply } from "./NeedsReply";
import styles from "./HomeView.module.css";

function ThreadLine({ item, now }: { item: ThreadListItem; now: number }) {
  const lead = rowAvatar(item);
  const marker = item.receipt ? receiptMarker(item.receipt) : null;
  return (
    <li>
      <button type="button" className={styles.row} onClick={() => navStore.getState().openThread(item.id, { fromOutside: true })}>
        <Avatar address={lead.address} name={lead.name} size={24} />
        <span className={clsx(styles.who, item.unreadCount > 0 && styles.unread)}>{formatParticipants(item.participants)}</span>
        <span className={styles.subject}>{item.subject || "(no subject)"}</span>
        {item.hasAttachments ? <Paperclip size={13} strokeWidth={1.5} color="var(--fg-3)" /> : null}
        {marker ? <span className={clsx("t-data", styles.marker, marker.tone === "ok" && styles.ok)}><Eye size={12} strokeWidth={1.5} />{marker.text}</span> : null}
        <span className={clsx("t-data", styles.time)}>{formatListTime(item.lastDate, now)}</span>
      </button>
    </li>
  );
}

function ReceiptLine({ item, now }: { item: TrackedMessage; now: number }) {
  const marker = receiptMarker(item.summary);
  const first = item.recipients[0];
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        onClick={() => (item.threadId !== null ? navStore.getState().openThread(item.threadId, { fromOutside: true }) : navStore.getState().go({ view: "receipts" }))}
      >
        <Avatar address={first?.email ?? ""} name={first?.name} size={24} />
        <span className={styles.who}>{formatParticipants(item.recipients.map((r) => ({ name: r.name, address: r.email })))}</span>
        <span className={styles.subject}>{item.subject}</span>
        <span className={clsx("t-data", styles.marker, marker.tone === "ok" && styles.ok)}><Eye size={12} strokeWidth={1.5} />{marker.text} opened</span>
        <span className={clsx("t-data", styles.time)}>{formatListTime(item.sentAt, now)}</span>
      </button>
    </li>
  );
}

function Block({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  if (empty) return null;
  return <HomeBlock title={title}>{children}</HomeBlock>;
}

export function HomeView() {
  const { data, loading } = useFlintQuery((api) => api.getHome(), [], { refetchOn: ["receipt"] });
  const now = Date.now();
  const nothing = data && !data.unreadPeople.length && !data.pinned.length && !data.awaitingReply.length && !data.recentReceipts.length;

  return (
    <div className={styles.home}>
      <PaneHeader />
      <div className={styles.scroll}>
        <div className={styles.column}>
          <h1 className="t-subject">{data ? greeting(now, data.greetingName) : "Home"}</h1>
          <p className={clsx("t-data", styles.date)}>{format(now, "EEEE, MMMM d")}</p>

          {loading && !data ? (
            <div className={styles.skeletons}><Skeleton width="30%" /><Skeleton width="90%" height={24} /><Skeleton width="85%" height={24} /><Skeleton width="88%" height={24} /></div>
          ) : null}

          {data ? (
            <>
              <CatchMeUp />
              <NeedsReply now={now} />
              <Block title="Unread from people" empty={!data.unreadPeople.length}>
                {data.unreadPeople.map((i) => <ThreadLine key={i.id} item={i} now={now} />)}
              </Block>
              <Block title="Pinned" empty={!data.pinned.length}>
                {data.pinned.map((i) => <ThreadLine key={i.id} item={i} now={now} />)}
              </Block>
              <Block title="Awaiting reply" empty={!data.awaitingReply.length}>
                {data.awaitingReply.map((i) => <ThreadLine key={i.id} item={i} now={now} />)}
              </Block>
              <Block title="Read receipts" empty={!data.recentReceipts.length}>
                {data.recentReceipts.map((r) => <ReceiptLine key={r.trackedId} item={r} now={now} />)}
              </Block>
              {nothing ? <p className={clsx("t-body", styles.quiet)}>Nothing needs you right now.</p> : null}
              {data.snoozedToday || data.scheduledCount ? (
                <p className={clsx("t-body", styles.footer)}>
                  {data.snoozedToday ? (
                    <button type="button" className={styles.link} onClick={() => navStore.getState().go({ view: "snoozed" })}>{pluralize(data.snoozedToday, "conversation")} snoozed for today</button>
                  ) : null}
                  {data.snoozedToday && data.scheduledCount ? <span aria-hidden> · </span> : null}
                  {data.scheduledCount ? (
                    <button type="button" className={styles.link} onClick={() => navStore.getState().go({ view: "scheduled" })}>{data.scheduledCount} scheduled to send</button>
                  ) : null}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
