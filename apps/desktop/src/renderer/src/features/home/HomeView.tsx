import { useState, type CSSProperties, type ReactNode } from "react";
import { Eye, Paperclip } from "lucide-react";
import clsx from "clsx";
import type { FlintApi, ThreadListItem, TrackedMessage } from "@flint/core";
import { useFlintQuery } from "../../lib/hooks";
import { formatListTime, formatParticipants } from "../../lib/format";
import { useResolvedTheme } from "../../lib/theme";
import { Avatar, Button, EmptyState, Skeleton } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { useApp } from "../../state/AppContext";
import { navStore } from "../../state/nav";
import { rowAvatar } from "../mail/rowText";
import { receiptMarker } from "../../state/receiptText";
import { greeting } from "./greeting";
import { CatchMeUp } from "./CatchMeUp";
import { HomeBlock } from "./HomeBlock";
import { NeedsReplyList, useNeedsReply } from "./NeedsReply";
import { bumpSceneOffset, parseSceneOffset, pickScene, readSceneMode, readSceneOffsetRaw, writeSceneMode, type SceneMode } from "./scene";
import { SCENES } from "./scenes";
import { useNow } from "./useNow";
import { Backdrop, useSceneLayers } from "./widgets/Backdrop";
import { Glance } from "./widgets/Glance";
import { Hero, SceneMenu } from "./widgets/Hero";
import { QuickActions } from "./widgets/QuickActions";
import { RecentDrafts, useDrafts } from "./widgets/RecentDrafts";
import { Today } from "./widgets/Today";
import { todayRows } from "./widgets/todayRows";
import { WaitingForOk } from "./widgets/WaitingForOk";
import styles from "./HomeView.module.css";

function ThreadLine({ item, now }: { item: ThreadListItem; now: number }) {
  const lead = rowAvatar(item);
  const marker = item.receipt ? receiptMarker(item.receipt) : null;
  const unread = item.unreadCount > 0;
  return (
    <li>
      <button type="button" className={styles.row} onClick={() => navStore.getState().openThread(item.id, { fromOutside: true })}>
        <Avatar address={lead.address} name={lead.name} size={24} />
        <span className={clsx(styles.who, unread && styles.unread)}>{formatParticipants(item.participants)}</span>
        {unread ? <span className="sr-only">unread</span> : null}
        <span className={styles.subject}>{item.subject || "(no subject)"}</span>
        {item.hasAttachments ? <Paperclip size={13} strokeWidth={1.5} color="var(--fg-3)" role="img" aria-label="Has attachments" /> : null}
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

/** Photo or Plain, and today's "Next photo" shift. Per device; works without storage for the session. */
function useSceneChoice(now: number) {
  const theme = useResolvedTheme();
  const [mode, setModeState] = useState<SceneMode>(readSceneMode);
  const [offsetRaw, setOffsetRaw] = useState(readSceneOffsetRaw);
  const scene = mode === "photo" ? pickScene(now, SCENES, parseSceneOffset(offsetRaw, now), theme === "light" ? "light" : undefined) : null;
  const setMode = (next: SceneMode) => {
    writeSceneMode(next);
    setModeState(next);
  };
  const next = () => setOffsetRaw((raw) => bumpSceneOffset(raw, Date.now()));
  return { mode, scene, setMode, next };
}

/** Every snoozed thread: the list is ordered by last message, so one due back today can sit past the first page. */
async function listSnoozed(api: FlintApi): Promise<ThreadListItem[]> {
  let items: ThreadListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listThreads({ view: "snoozed", limit: 200, cursor });
    items = [...items, ...page.items];
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** Still loading for the first time: its block may be about to appear. */
const pending = (q: { data: unknown; error: Error | undefined }) => q.data === undefined && !q.error;

export function HomeView() {
  const now = useNow(60_000);
  const { sidebar } = useApp();
  const { data, loading, error, refetch } = useFlintQuery((api) => api.getHome(), [], { refetchOn: ["receipt"] });
  const scheduledQ = useFlintQuery((api) => api.listScheduled(), [], { refetchOn: ["send"] });
  const scheduled = scheduledQ.data ?? [];
  const snoozed = useFlintQuery(listSnoozed, []).data ?? [];
  const needsReply = useNeedsReply();
  const drafts = useDrafts();
  const choice = useSceneChoice(now);
  const { layers, shown, onLoad } = useSceneLayers(choice.scene);

  const firstSync = sidebar?.accounts.some((a) => a.sync.state === "syncing" && !a.sync.lastSyncAt) ?? false;
  const waiting = scheduled.some((s) => s.status === "awaiting_approval");
  const others = !pending(needsReply) && !pending(drafts) && !needsReply.data?.length && !drafts.data?.length && !todayRows(snoozed, scheduled, now).length;
  const nothing = data && !data.unreadPeople.length && !data.pinned.length && !data.awaitingReply.length && !data.recentReceipts.length && !waiting && others;
  const sceneStyle = shown ? ({ "--photo-scrim": shown.scrim } as CSSProperties) : undefined;

  return (
    <div className={clsx(styles.home, choice.scene && styles.photoOn, shown && styles.scenic)} style={sceneStyle}>
      <Backdrop layers={layers} onLoad={onLoad} ready={shown !== null} />
      <PaneHeader className={styles.header}>
        <SceneMenu mode={choice.mode} onMode={choice.setMode} onNext={choice.next} />
      </PaneHeader>
      <div className={styles.scroll}>
        <Hero title={data ? greeting(now, data.greetingName) : "Home"} now={now} scene={shown} />
        <div className={styles.sheet}>
          {sidebar ? <Glance counts={sidebar.counts} /> : null}

          {loading && !data && !error ? (
            <div className={styles.skeletons}><Skeleton width="30%" /><Skeleton width="90%" height={24} /><Skeleton width="85%" height={24} /><Skeleton width="88%" height={24} /></div>
          ) : null}

          {error && !data ? (
            <EmptyState
              className={styles.failed}
              markSize={48}
              title="Couldn't load Home"
              description="Flint couldn't read your mail just now."
              action={<Button size="sm" variant="ghost" onClick={refetch}>Try again</Button>}
            />
          ) : null}

          {data ? (
            <>
              <CatchMeUp />
              <NeedsReplyList rows={needsReply.data ?? []} now={now} />
              <WaitingForOk scheduled={scheduled} onStale={scheduledQ.refetch} />
              <Today snoozed={snoozed} scheduled={scheduled} now={now} />
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
              <RecentDrafts all={drafts.data ?? []} now={now} />
              {nothing ? (
                <p className={clsx("t-body", styles.quiet)} role="status">{firstSync ? "Getting your mail…" : "Nothing needs you right now."}</p>
              ) : null}
              <QuickActions />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
