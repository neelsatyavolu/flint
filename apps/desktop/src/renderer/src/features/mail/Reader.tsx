import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pin, BellOff } from "lucide-react";
import clsx from "clsx";
import type { ThreadDetail } from "@flint/core";
import { flint } from "../../lib/api";
import { formatPresetTime } from "../../lib/time";
import { Badge, Button, EmptyState, Skeleton, useToast } from "../../ui";
import { useApp } from "../../state/AppContext";
import { replyTarget } from "../../state/compose";
import { quickRepliesEligible, quickRepliesKey } from "../../state/quickRepliesGate";
import { listStore } from "../../state/listStore";
import { useNav } from "../../state/nav";
import { scheduleMarkRead } from "../../state/readOnOpen";
import { CATEGORY_TITLES } from "../../state/viewMeta";
const InlineReply = lazy(() => import("../compose/InlineReply").then((m) => ({ default: m.InlineReply })));
import { QuickReplies } from "../ai/QuickReplies";
import { ThreadSummary } from "../ai/ThreadSummary";
import { MessageItem } from "./MessageItem";
import { ReaderToolbar } from "./ReaderToolbar";
import { initialExpanded, wordCount } from "./quotedText";
import { useThread } from "./useThread";
import styles from "./Reader.module.css";

function ThreadHeader({ thread }: { thread: ThreadDetail }) {
  const { accounts } = useApp();
  const toast = useToast();
  const account = accounts.find((a) => a.id === thread.accountId);
  const unsub = thread.messages.findLast((m) => m.unsubscribe);
  const chips = [
    thread.pinned ? <Badge key="pin"><Pin size={10} strokeWidth={1.5} style={{ marginRight: 4 }} />Pinned</Badge> : null,
    thread.muted ? <Badge key="mute"><BellOff size={10} strokeWidth={1.5} style={{ marginRight: 4 }} />Muted</Badge> : null,
    thread.snoozedUntil && thread.snoozedUntil > Date.now() ? <Badge key="snz" tone="accent">Snoozed until {formatPresetTime(thread.snoozedUntil)}</Badge> : null,
    thread.category !== "people" ? <Badge key="cat">{CATEGORY_TITLES[thread.category]}</Badge> : null,
    account && accounts.length > 1 ? (
      <Badge key="acct">
        <span className={styles.acctDot} style={{ background: account.color ?? "var(--fg-3)" }} aria-hidden />
        {account.email}
      </Badge>
    ) : null,
  ].filter(Boolean);

  const unsubscribe = () => {
    if (!unsub) return;
    void flint.unsubscribe(unsub.id).then(
      ({ method }) => toast.show({ message: method === "browser" ? "Opened the unsubscribe page" : method === "mailto" ? "Sent an unsubscribe email" : "Unsubscribed" }),
      () => toast.show({ message: "Couldn't unsubscribe. Try again.", level: "error" }),
    );
  };

  return (
    <div className={styles.threadHead}>
      <h1 className={clsx("t-subject selectable", styles.subject)}>{thread.subject || "(no subject)"}</h1>
      {chips.length || unsub ? (
        <div className={styles.chips}>
          {chips}
          {unsub ? <Button size="sm" variant="ghost" onClick={unsubscribe}>Unsubscribe</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

function ThreadBody({ thread, refetch }: { thread: ThreadDetail; refetch: () => void }) {
  const { selfAddresses } = useApp();
  const [expanded, setExpanded] = useState(() => initialExpanded(thread.messages));
  const firstOpen = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const target = replyTarget(thread.messages);
  const words = useMemo(() => thread.messages.reduce((n, m) => n + wordCount(m), 0), [thread.messages]);

  useEffect(() => {
    const el = firstOpen.current;
    const scroller = el?.closest("[data-reader-scroll]");
    if (el && scroller instanceof HTMLElement && thread.messages.length > 3) scroller.scrollTop = Math.max(0, el.offsetTop - 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback((id: number) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const firstExpandedId = thread.messages.find((m) => expanded.has(m.id))?.id;
  const [seedText, setSeedText] = useState<string | undefined>(undefined);

  return (
    <>
      <ThreadHeader thread={thread} />
      <ThreadSummary threadId={thread.id} messageCount={thread.messages.length} wordCount={words} />
      <div className={styles.messages}>
        {thread.messages.map((m) => (
          <div key={m.id} ref={m.id === firstExpandedId ? firstOpen : undefined}>
            <MessageItem message={m} expanded={expanded.has(m.id)} selfAddresses={selfAddresses} onToggle={toggle} onUpdated={refetch} now={now} />
          </div>
        ))}
      </div>
      {target ? (
        <div className={styles.foot}>
          {quickRepliesEligible(thread.category, thread.messages) ? (
            <QuickReplies threadId={thread.id} cacheKey={quickRepliesKey(thread.id, thread.messages)} onPick={setSeedText} />
          ) : null}
          <Suspense fallback={null}><InlineReply threadId={thread.id} messageId={target.id} from={(target.isFromMe ? target.to[0] : target.from[0]) ?? target.from[0]} seedText={seedText} /></Suspense>
        </div>
      ) : null}
      <div className={styles.askClearance} aria-hidden />
    </>
  );
}

function ReaderSkeleton() {
  return (
    <div className={styles.threadHead} role="status" aria-label="Loading conversation">
      <Skeleton width="60%" height={24} />
      <div style={{ height: 16 }} />
      <Skeleton width="90%" /><div style={{ height: 8 }} /><Skeleton width="80%" /><div style={{ height: 8 }} /><Skeleton width="45%" />
    </div>
  );
}

export function Reader() {
  const openId = useNav((s) => s.openId);
  const { settings } = useApp();
  const { thread, error, refetch } = useThread(openId);
  const full = settings.appearance.layout === "full";
  const mode = settings.inbox.markReadOnOpen;

  useEffect(() => {
    if (openId === null || !thread) return;
    return scheduleMarkRead({ api: flint, list: listStore }, mode, openId);
    // Only when a different thread finishes loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, thread?.id, mode]);

  return (
    <section className={clsx(styles.reader, full && styles.full)} aria-label="Conversation">
      <ReaderToolbar thread={thread} />
      <div className={styles.scroll} data-reader-scroll>
        {openId === null ? (
          <EmptyState />
        ) : thread ? (
          <ThreadBody key={thread.id} thread={thread} refetch={refetch} />
        ) : error ? (
          <EmptyState title="Couldn't open this conversation" description="It may have moved or been deleted." action={<Button variant="ghost" onClick={refetch}>Try again</Button>} markSize={48} />
        ) : (
          <ReaderSkeleton />
        )}
      </div>
    </section>
  );
}
