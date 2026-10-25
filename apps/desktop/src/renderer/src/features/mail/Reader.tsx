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
import { useInlineReply } from "../../state/inlineReply";
import type { InlineReplyCloseResult } from "../compose/inlineReplyTypes";
import { scheduleMarkRead } from "../../state/readOnOpen";
import { CATEGORY_TITLES } from "../../state/viewMeta";
const InlineReplyDock = lazy(() => import("../compose/InlineReplyDock").then((m) => ({ default: m.InlineReplyDock })));
import { QuickReplies } from "../ai/QuickReplies";
import { ThreadSummary } from "../ai/ThreadSummary";
import { DraftCard } from "./DraftCard";
import { MessageItem } from "./MessageItem";
import { ReaderToolbar } from "./ReaderToolbar";
import { initialExpanded, wordCount } from "./quotedText";
import { scrollTargetTop } from "./scrollTarget";
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
  const messagesRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const [draftRev, setDraftRev] = useState(0);
  const now = Date.now();
  const target = replyTarget(thread.messages);
  const words = useMemo(() => thread.messages.reduce((n, m) => n + wordCount(m), 0), [thread.messages]);
  const request = useInlineReply((s) => s.request);
  const dockOpen = request !== null && request.threadId === thread.id;

  /** Puts the newest card fully in view, with the Ask clearance below it. */
  const showNewest = useCallback(() => {
    const list = messagesRef.current;
    const scroller = list?.closest("[data-reader-scroll]");
    const cards = list?.children;
    const last = cards?.[cards.length - 1];
    if (!(scroller instanceof HTMLElement) || !(last instanceof HTMLElement)) return;
    const box = last.getBoundingClientRect();
    // Quick replies sit under the newest message; keep them in view too.
    const end = Math.max(box.bottom, footRef.current?.getBoundingClientRect().bottom ?? 0);
    const top = box.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const clearance = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--ask-clearance")) || 72;
    scroller.scrollTop = scrollTargetTop({ cardTop: top, cardHeight: end - box.top, viewport: scroller.clientHeight, clearance });
  }, []);

  // Open on the newest message. Mail frames size themselves after load, so follow the growth until the reader scrolls.
  useEffect(() => {
    showNewest();
    const list = messagesRef.current;
    const scroller = list?.closest("[data-reader-scroll]");
    if (!list || !(scroller instanceof HTMLElement)) return;
    const stop = () => {
      userScrolled.current = true;
    };
    scroller.addEventListener("wheel", stop, { passive: true });
    scroller.addEventListener("touchmove", stop, { passive: true });
    scroller.addEventListener("keydown", stop);
    // Content above (the summary) and frames inside the cards grow after first paint, so re-apply for a moment.
    const poll = setInterval(() => !userScrolled.current && showNewest(), 100);
    const timer = setTimeout(() => clearInterval(poll), 2500);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("touchmove", stop);
      scroller.removeEventListener("keydown", stop);
    };
  }, [showNewest]);

  useEffect(() => {
    if (!dockOpen) return;
    // The reply takes over the bottom of the reader; stop pulling the view back to the newest message.
    userScrolled.current = true;
    dockRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [dockOpen, request?.nonce]);

  const toggle = useCallback((id: number) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const closeDock = useCallback(
    (result: InlineReplyCloseResult) => {
      useInlineReply.getState().close();
      setDraftRev((n) => n + 1);
      refetch();
      if (result.reason === "sent" || result.reason === "closed") requestAnimationFrame(showNewest);
    },
    [refetch, showNewest],
  );

  const openingDraft = dockOpen ? request.draftId : undefined;
  const liveDraftId = useInlineReply((s) => s.liveDraftId);
  const drafts = thread.draftIds.filter((id) => id !== openingDraft && id !== liveDraftId);
  const quickReply = (seedText: string) => target && useInlineReply.getState().open({ threadId: thread.id, messageId: target.id, mode: "reply", seedText });

  return (
    <>
      <ThreadHeader thread={thread} />
      <ThreadSummary threadId={thread.id} messageCount={thread.messages.length} wordCount={words} />
      <div className={styles.messages} ref={messagesRef}>
        {thread.messages.map((m) => (
          <MessageItem key={m.id} message={m} expanded={expanded.has(m.id)} selfAddresses={selfAddresses} onToggle={toggle} onUpdated={refetch} now={now} />
        ))}
      </div>
      {drafts.length ? (
        <div className={styles.drafts}>
          {drafts.map((id) => (
            <DraftCard key={id} draftId={id} threadId={thread.id} messageId={target?.id ?? null} reloadKey={draftRev} onChanged={() => { setDraftRev((n) => n + 1); refetch(); }} />
          ))}
        </div>
      ) : null}
      {target && !dockOpen && quickRepliesEligible(thread.category, thread.messages) ? (
        <div className={styles.foot} ref={footRef}>
          <QuickReplies threadId={thread.id} cacheKey={quickRepliesKey(thread.id, thread.messages)} onPick={quickReply} />
        </div>
      ) : null}
      {dockOpen ? (
        <div className={styles.dock} ref={dockRef} data-inline-reply-mount>
          <Suspense fallback={null}><InlineReplyDock key={request.nonce} request={request} onClose={closeDock} /></Suspense>
        </div>
      ) : (
        <div className={styles.askClearance} aria-hidden />
      )}
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

  // A reply dock belongs to the thread it was opened in. Leaving that thread ends it, so coming back
  // opens the saved draft as a card instead of creating a second draft.
  useEffect(() => {
    const reply = useInlineReply.getState();
    if (reply.request !== null && reply.request.threadId !== openId) {
      reply.close();
      reply.setLiveDraft(null);
    }
  }, [openId]);

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
