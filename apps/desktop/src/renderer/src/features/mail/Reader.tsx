import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pin, BellOff, ChevronDown as CaretDown } from "lucide-react";
import clsx from "clsx";
import type { FlintApi, MessageView, ThreadDetail, ThreadId } from "@flint/core";
import { flint } from "../../lib/api";
import { formatPresetTime } from "../../lib/time";
import { Badge, Button, Dialog, EmptyState, Menu, Skeleton, useToast } from "../../ui";
import { displayName } from "../../lib/format";
import { useApp } from "../../state/AppContext";
import { replyTarget } from "../../state/compose";
import { quickRepliesEligible, quickRepliesKey } from "../../state/quickRepliesGate";
import { listStore } from "../../state/listStore";
import { useNav } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { useInlineReply } from "../../state/inlineReply";
import type { InlineReplyCloseResult } from "../compose/inlineReplyTypes";
import { scheduleMarkRead } from "../../state/readOnOpen";
import { CATEGORY_TITLES } from "../../state/viewMeta";
const loadReplyDock = () => import("../compose/InlineReplyDock");
const InlineReplyDock = lazy(() => loadReplyDock().then((m) => ({ default: m.InlineReplyDock })));
import { QuickReplies } from "../ai/QuickReplies";
import { ThreadSummary } from "../ai/ThreadSummary";
import { DraftCard } from "./DraftCard";
import { FrameGateContext, type FrameGate } from "./frameGate";
import { MessageItem } from "./MessageItem";
import { ReaderToolbar, OUT_OF_INBOX } from "./ReaderToolbar";
import { categoryMenuItems } from "./rowMenu";
import { initialExpanded, wordCount } from "./quotedText";
import { scrollTargetTop } from "./scrollTarget";
import { prefetchThread, useThread } from "./useThread";
import { unsubscribeExplanation, unsubscribedMessage } from "./blockSender";
import { PRINT_EVENT, printThread } from "./printThread";
import styles from "./Reader.module.css";


export function ThreadHeader({ thread }: { thread: ThreadDetail }) {
  const { accounts } = useApp();
  const view = useNav((s) => s.view);
  const { run } = useThreadActions();
  const [confirmUnsub, setConfirmUnsub] = useState(false);
  const account = accounts.find((a) => a.id === thread.accountId);
  const unsub = thread.messages.findLast((m) => m.unsubscribe);
  const chips = [
    thread.pinned ? <Badge key="pin"><Pin size={10} strokeWidth={1.5} />Pinned</Badge> : null,
    thread.muted ? <Badge key="mute"><BellOff size={10} strokeWidth={1.5} />Muted</Badge> : null,
    thread.snoozedUntil && thread.snoozedUntil > Date.now() ? <Badge key="snz" tone="accent">Snoozed until {formatPresetTime(thread.snoozedUntil)}</Badge> : null,
    thread.category !== "people" ? (
      OUT_OF_INBOX.has(view) ? (
        <Badge key="cat">{CATEGORY_TITLES[thread.category]}</Badge>
      ) : (
        <Menu
          key="cat"
          items={categoryMenuItems(thread.category, (action) => void run(action, [thread.id]))}
          placement="bottom-start"
          trigger={
            <button type="button" className={styles.categoryChip} aria-label={`Category: ${CATEGORY_TITLES[thread.category]}. Change category`}>
              {CATEGORY_TITLES[thread.category]}
              <CaretDown size={10} strokeWidth={1.5} aria-hidden />
            </button>
          }
        />
      )
    ) : null,
    account && accounts.length > 1 ? (
      <Badge key="acct" className={styles.acctBadge}>
        <span className={styles.acctDot} style={{ background: account.color ?? "var(--fg-3)" }} aria-hidden />
        <span className={styles.acctText} title={account.email}>{account.email}</span>
      </Badge>
    ) : null,
  ].filter(Boolean);

  return (
    <div className={styles.threadHead}>
      <h1 className={clsx("t-subject selectable", styles.subject)} tabIndex={-1} data-thread-subject>{thread.subject || "(no subject)"}</h1>
      {chips.length || unsub ? (
        <div className={styles.chips}>
          {chips}
          {unsub ? <button type="button" className={styles.categoryChip} onClick={() => setConfirmUnsub(true)}>Unsubscribe</button> : null}
        </div>
      ) : null}
      {unsub ? <UnsubscribeDialog message={unsub} open={confirmUnsub} onClose={() => setConfirmUnsub(false)} /> : null}
    </div>
  );
}

/** Every Inbox conversation from `address`, read 200 at a time. */
export async function inboxThreadIdsFrom(address: string, api: Pick<FlintApi, "listThreads"> = flint): Promise<ThreadId[]> {
  let ids: ThreadId[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listThreads({ view: "search", search: `from:${address} in:inbox`, limit: 200, ...(cursor ? { cursor } : {}) });
    ids = [...ids, ...page.items.map((t) => t.id)];
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return ids;
}

/** Says how Flint will unsubscribe before it does, then offers to archive what that sender already sent. */
function UnsubscribeDialog({ message, open, onClose }: { message: MessageView; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { run } = useThreadActions();
  const sender = message.from[0];
  const name = sender ? displayName(sender) : "this sender";

  const archiveTheirs = async (address: string) => {
    try {
      const ids = await inboxThreadIdsFrom(address);
      if (ids.length) await run({ type: "archive" }, ids);
      else toast.show({ message: `No mail from ${name} is left in your Inbox` });
    } catch {
      toast.show({ message: `Couldn't archive mail from ${name}. Try again.`, level: "error" });
    }
  };

  const confirm = async () => {
    onClose();
    try {
      const { method } = await flint.unsubscribe(message.id);
      toast.show({
        message: unsubscribedMessage(method),
        action: sender?.address ? { label: "Also archive these", onClick: () => void archiveTheirs(sender.address) } : undefined,
      });
    } catch {
      toast.show({ message: "Couldn't unsubscribe. Try again.", level: "error" });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Unsubscribe from ${name}?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void confirm()}>Unsubscribe</Button>
        </>
      }
    >
      <p className="t-body">{message.unsubscribe ? unsubscribeExplanation(message.unsubscribe) : null}</p>
    </Dialog>
  );
}

/** The current time, refreshed once a minute: enough for "3:49 PM" and "Tue" labels, and stable between renders. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Longest the reader waits for mail frames to report their height before showing the thread anyway. */
const REVEAL_TIMEOUT_MS = 700;
const NOOP = () => undefined;

type BodyProps = {
  thread: ThreadDetail;
  refetch: () => void;
  /** Laid out but invisible and not scrolling, while the thread before it stays on screen. */
  staged: boolean;
  /** Still the previous thread while the open one loads: dimmed after a moment and not clickable. */
  stale?: boolean;
  /** Called once, when every mail frame has its height. The reader then swaps this thread in. */
  onReady: (id: number) => void;
};

function ThreadBody({ thread, refetch, staged, stale, onReady }: BodyProps) {
  const { selfAddresses } = useApp();
  const [expanded, setExpanded] = useState(() => initialExpanded(thread.messages));
  const stageRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);
  const [draftRev, setDraftRev] = useState(0);
  const now = useMinuteClock();
  const target = replyTarget(thread.messages);
  const words = useMemo(() => thread.messages.reduce((n, m) => n + wordCount(m), 0), [thread.messages]);
  const request = useInlineReply((s) => s.request);
  const dockOpen = request !== null && request.threadId === thread.id;

  // Hold the reveal until the frames in the first paint know their height.
  const pending = useRef(0);
  const announced = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const announce = useCallback(() => {
    if (announced.current) return;
    announced.current = true;
    onReadyRef.current(thread.id);
  }, [thread.id]);
  const gate = useMemo<FrameGate>(
    () => ({
      begin: () => {
        if (announced.current) return NOOP;
        pending.current += 1;
        let done = false;
        return () => {
          if (done) return;
          done = true;
          pending.current -= 1;
          if (pending.current <= 0) announce();
        };
      },
    }),
    [announce],
  );
  useLayoutEffect(() => {
    if (pending.current <= 0) announce();
    const timer = setTimeout(announce, REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [announce]);

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

  // Open on the newest message. Content above it (the summary) and the frames inside the cards grow after first
  // paint; a ResizeObserver re-applies the position before the next paint, so the view never visibly hops.
  useLayoutEffect(() => {
    if (staged) return;
    const stage = stageRef.current;
    const scroller = stage?.closest("[data-reader-scroll]");
    if (!stage || !(scroller instanceof HTMLElement)) return;
    userScrolled.current = false;
    showNewest();
    const stop = () => {
      userScrolled.current = true;
    };
    scroller.addEventListener("wheel", stop, { passive: true });
    scroller.addEventListener("touchmove", stop, { passive: true });
    scroller.addEventListener("keydown", stop);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => !userScrolled.current && showNewest());
    ro?.observe(stage);
    const timer = setTimeout(() => ro?.disconnect(), 3000);
    return () => {
      clearTimeout(timer);
      ro?.disconnect();
      scroller.removeEventListener("wheel", stop);
      scroller.removeEventListener("touchmove", stop);
      scroller.removeEventListener("keydown", stop);
    };
  }, [staged, showNewest]);

  // The reply is part of the thread, at its end. Opening it brings the whole dock to the bottom of the reader, and it
  // stays in view as the editor grows.
  useLayoutEffect(() => {
    if (!dockOpen || staged) return;
    const mount = dockRef.current;
    const scroller = mount?.closest("[data-reader-scroll]");
    if (!mount || !(scroller instanceof HTMLElement)) return;
    // The reply takes over the bottom of the reader; stop pulling the view back to the newest message.
    userScrolled.current = true;
    mount.focus({ preventScroll: true });
    const bottomAlign = () => {
      scroller.scrollTop += mount.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    };
    const keepVisible = () => {
      const over = mount.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
      if (over > 0) scroller.scrollTop += over;
    };
    bottomAlign();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(keepVisible);
    ro?.observe(mount);
    return () => ro?.disconnect();
  }, [dockOpen, request?.nonce, staged]);

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
    <FrameGateContext.Provider value={gate}>
      <div ref={stageRef} className={clsx(styles.stage, staged && styles.staged, stale && styles.stale)} aria-hidden={staged || undefined} inert={staged || stale || undefined}>
        <ThreadHeader thread={thread} />
        <div className={styles.summarySlot}>
          <ThreadSummary threadId={thread.id} messageCount={thread.messages.length} wordCount={words} />
        </div>
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
          <div className={styles.dock} ref={dockRef} tabIndex={-1} data-inline-reply-mount>
            <Suspense fallback={<div className={styles.dockLoading} aria-hidden />}><InlineReplyDock key={request.nonce} request={request} onClose={closeDock} /></Suspense>
          </div>
        ) : (
          <div className={styles.askClearance} aria-hidden />
        )}
      </div>
    </FrameGateContext.Provider>
  );
}

/** Same dimensions as a loaded thread's header and first card, so the real thing replaces it without moving. */
function ReaderSkeleton() {
  return (
    <div role="status" aria-label="Loading conversation">
      <div className={styles.threadHead}>
        <Skeleton width="60%" height={24} />
      </div>
      <div className={styles.messages}>
        <div className={styles.skelCard}>
          <div className={styles.skelHead}>
            <Skeleton width={32} height={32} />
            <Skeleton width="30%" />
          </div>
          <div className={styles.skelLines}>
            <Skeleton width="90%" /><Skeleton width="80%" /><Skeleton width="45%" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Warms the threads around the open one so j and k land on an already loaded conversation. */
function usePrefetchNeighbors(openId: number | null, loaded: boolean) {
  useEffect(() => {
    if (openId === null || !loaded) return;
    const items = listStore.getState().items;
    const at = items.findIndex((i) => i.id === openId);
    if (at < 0) return;
    const order = [items[at + 1], items[at - 1], items[at + 2], items[at - 2]];
    const timers = order.flatMap((item, n) => (item ? [setTimeout(() => prefetchThread(item.id), 80 + n * 120)] : []));
    return () => timers.forEach(clearTimeout);
  }, [openId, loaded]);
}

/** Loads a row's thread shortly after the pointer rests on it, so clicking it opens at once. */
function useHoverPrefetch() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const over = (e: PointerEvent) => {
      clearTimeout(timer);
      const row = e.target instanceof Element ? e.target.closest("[data-thread-id]") : null;
      const id = Number(row?.getAttribute("data-thread-id"));
      if (row && Number.isFinite(id)) timer = setTimeout(() => prefetchThread(id), 60);
    };
    document.addEventListener("pointerover", over);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
    };
  }, []);
}

/** How the last thread was opened, so the reader can move focus for keyboard users and announce it to everyone else. */
let lastInput: "keyboard" | "pointer" = "pointer";
const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock"]);
function useInputModality() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!MODIFIERS.has(e.key)) lastInput = "keyboard";
    };
    const pointer = () => {
      lastInput = "pointer";
    };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", pointer, true);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", pointer, true);
    };
  }, []);
}

/**
 * Focus stays where the user is typing, and in the conversation list, so arrowing through it (which opens each thread
 * in the split view) keeps the list's own keys working; the opened subject is announced instead. Otherwise keyboard
 * opens land on the subject.
 */
export function focusIsBusy(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.closest("input, textarea, select, [role='dialog'], [role='listbox'], [data-composer], [data-inline-reply-mount]") !== null);
}

/** Prints the open thread when File > Print or the More menu asks. */
function usePrintListener(thread: ThreadDetail | undefined) {
  const toast = useToast();
  const current = useRef(thread);
  current.current = thread;
  useEffect(() => {
    const onPrint = () => {
      const t = current.current;
      if (!t) return;
      void printThread(t, (id) => flint.getMessage(id)).catch(() => toast.show({ message: "Couldn't print this conversation. Try again.", level: "error" }));
    };
    window.addEventListener(PRINT_EVENT, onPrint);
    return () => window.removeEventListener(PRINT_EVENT, onPrint);
  }, [toast]);
}

export function Reader() {
  const openId = useNav((s) => s.openId);
  const { settings } = useApp();
  const { thread, error, refetch } = useThread(openId);
  const full = settings.appearance.layout === "full";
  const mode = settings.inbox.markReadOnOpen;
  // The thread on screen stays until the next one is laid out, so opening never flashes an empty or loading state.
  const [shownId, setShownId] = useState<number | null>(null);
  const shown = useRef<ThreadDetail | undefined>(undefined);
  if (thread && thread.id === shownId) shown.current = thread;
  const front = shownId !== null && shown.current?.id === shownId && openId !== null ? shown.current : undefined;
  const staged = thread && thread.id !== front?.id ? thread : undefined;
  const revealed = useCallback((id: number) => setShownId(id), []);
  const bodies = [
    front ? <ThreadBody key={front.id} thread={front.id === thread?.id ? thread : front} refetch={refetch} staged={false} stale={front.id !== openId} onReady={revealed} /> : <ReaderSkeleton key="loading" />,
    staged ? <ThreadBody key={staged.id} thread={staged} refetch={refetch} staged onReady={revealed} /> : null,
  ];
  usePrefetchNeighbors(openId, thread !== undefined);
  // Fetch the reply editor's code once a thread is open, so pressing r never waits on it.
  useEffect(() => {
    if (thread === undefined) return;
    const t = setTimeout(() => void loadReplyDock().catch(() => undefined), 400);
    return () => clearTimeout(t);
  }, [thread === undefined]);
  useHoverPrefetch();
  useInputModality();
  usePrintListener(front?.id === openId ? front : undefined);

  useEffect(() => {
    if (openId === null) setShownId(null);
  }, [openId]);

  // Once a newly opened thread is on screen: keyboard users get focus on its subject, everyone else an announcement.
  const sectionRef = useRef<HTMLElement>(null);
  const [announcement, setAnnouncement] = useState("");
  const frontId = front?.id;
  const frontSubject = front?.subject;
  useEffect(() => {
    if (frontId === undefined || frontId !== openId) return;
    const heading = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-thread-subject]") ?? []).find((h) => !h.closest("[aria-hidden='true']"));
    if (lastInput === "keyboard" && heading && !focusIsBusy()) {
      heading.focus({ preventScroll: true });
      setAnnouncement("");
    } else {
      setAnnouncement(`Opened ${frontSubject || "(no subject)"}`);
    }
    // Only when a different thread comes to the front.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontId]);

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
    <section ref={sectionRef} className={clsx(styles.reader, full && styles.full)} aria-label="Conversation">
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <ReaderToolbar thread={thread} />
      <div className={styles.scroll} data-reader-scroll>
        {openId === null ? (
          <EmptyState />
        ) : error && !thread ? (
          <EmptyState title="Couldn't open this conversation" description="It may have moved or been deleted." action={<Button variant="ghost" onClick={refetch}>Try again</Button>} markSize={48} />
        ) : (
          bodies
        )}
      </div>
    </section>
  );
}
