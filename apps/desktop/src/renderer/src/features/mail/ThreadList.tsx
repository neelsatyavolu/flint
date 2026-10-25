import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import type { Bundle, ThreadListItem } from "@flint/core";
import { ContextMenu, EmptyState, SkeletonRows, Button } from "../../ui";
import { useApp } from "../../state/AppContext";
import { groupByDate, rangeIds } from "../../state/grouping";
import { listStore, useList } from "../../state/listStore";
import { navStore, useNav } from "../../state/nav";
import { LABEL_ROW_HEIGHT, rowHeight } from "../../state/rowMetrics";
import { emptyCopy } from "../../state/viewMeta";
import { useThreadActions } from "../../state/useActions";
import { BundleRow } from "./BundleRow";
import { ListFooter } from "./ListFooter";
import { ThreadRow } from "./ThreadRow";
import { deleteDraftRow, openDraftRow, openMovePicker, openSnooze, replyTo } from "./mailCommands";
import { rowMenuItems } from "./rowMenu";
import { activeLabelIndex, rowOffsets } from "./stickyLabel";
import { flint } from "../../lib/api";
import { useToast } from "../../ui/Toast";
import styles from "./ThreadList.module.css";

const OVERSCAN = 8;
/** A list that loads faster than this never shows its skeleton, so quick view changes do not flash. */
const SKELETON_DELAY_MS = 140;

function useDelayedFlag(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on && shown;
}
const LOAD_AHEAD = 12;
const INBOX_LIKE = new Set(["inbox", "snoozed", "pinned", "drafts", "sent", "folder", "search"]);

export function ThreadList() {
  const { settings, accounts } = useApp();
  const nav = useNav((s) => s);
  const entries = useList((s) => s.entries);
  const status = useList((s) => s.status);
  const stale = useList((s) => s.stale);
  const error = useList((s) => s.error);
  const hasMore = useList((s) => s.nextCursor !== null);
  const serverSearch = useList((s) => s.serverSearch);
  const loadingOlder = useList((s) => s.loadingOlder);
  const olderOnServer = useList((s) => s.olderOnServer);
  const listKey = useList((s) => s.queryKey);
  const autoOlder = useRef<string | null>(null);
  const { run } = useThreadActions();
  const toast = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stickyAt, setStickyAt] = useState(-1);
  const pending = (status === "loading" || status === "idle") && entries.length === 0;
  const showSkeleton = useDelayedFlag(pending, SKELETON_DELAY_MS);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const { density, previewLines, avatars, accountColors } = settings.appearance;
  const compact = density === "compact";
  const rows = useMemo(() => groupByDate(entries, now), [entries, now]);
  const threadH = rowHeight(density, previewLines);
  const heights = useMemo(() => rows.map((r) => (r.kind === "label" ? LABEL_ROW_HEIGHT : threadH)), [rows, threadH]);
  const offsets = useMemo(() => rowOffsets(heights), [heights]);
  const labelIdx = useMemo(() => rows.flatMap((r, i) => (r.kind === "label" ? [i] : [])), [rows]);
  const colors = useMemo(() => new Map(accounts.map((a) => [a.id, a.color])), [accounts]);
  const showAccountColor = accountColors && accounts.length > 1 && !nav.accountId;

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => heights[i] ?? threadH,
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: OVERSCAN,
    initialRect: { width: 380, height: 900 },
  });
  const items = virt.getVirtualItems();
  const lastVisible = items.at(-1)?.index ?? 0;

  useEffect(() => {
    if (hasMore && rows.length > 0 && lastVisible >= rows.length - LOAD_AHEAD) void listStore.getState().loadMore();
  }, [hasMore, lastVisible, rows.length]);

  // Reaching the end of what is local pulls one batch of older mail by itself; after that the footer asks.
  useEffect(() => {
    if (hasMore || !olderOnServer || status !== "ready" || listKey === null || autoOlder.current === listKey) return;
    if (rows.length > 0 && lastVisible < rows.length - 1) return;
    autoOlder.current = listKey;
    void listStore.getState().loadOlder();
  }, [hasMore, olderOnServer, status, listKey, rows.length, lastVisible]);

  // The scroller stays mounted across lists that paint from memory, so each new list starts at the top.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [listKey]);

  const onScroll = useCallback(() => {
    const top = scrollRef.current?.scrollTop ?? 0;
    const next = activeLabelIndex(labelIdx, offsets, top);
    setStickyAt((cur) => (cur === next ? cur : next));
  }, [labelIdx, offsets]);
  useEffect(onScroll, [onScroll]);

  useEffect(() => {
    if (!nav.cursorKey) return;
    const at = rows.findIndex((r) => r.key === nav.cursorKey);
    if (at !== -1) virt.scrollToIndex(at, { align: "auto" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.cursorKey]);

  const onSelect = useCallback((item: ThreadListItem, e: MouseEvent) => {
    const n = navStore.getState();
    const key = `t${item.id}`;
    if (e.metaKey || e.ctrlKey) {
      n.toggleSelected(item.id);
      n.setCursor(key);
    } else if (e.shiftKey) {
      n.setSelected(rangeIds(listStore.getState().entries, n.cursorKey ?? (n.openId !== null ? `t${n.openId}` : null), key));
      n.setCursor(key);
    } else if (n.view === "drafts") {
      n.setCursor(key);
      void openDraftRow(item, toast.show);
    } else {
      n.openThread(item.id);
    }
  }, [toast.show]);

  const onBundle = useCallback((b: Bundle) => navStore.getState().openCategory(b.category), []);
  const onPin = useCallback((i: ThreadListItem) => void run({ type: "pin", pinned: !i.pinned }, [i.id]), [run]);
  const onArchive = useCallback((i: ThreadListItem) => void run({ type: "archive" }, [i.id]), [run]);
  const onTrash = useCallback(
    (i: ThreadListItem) => (i.draft?.draftId != null ? void deleteDraftRow(i.draft.draftId, toast.show) : void run({ type: "trash" }, [i.id])),
    [run, toast.show],
  );
  const onSnooze = useCallback((i: ThreadListItem) => openSnooze([i.id]), []);
  const menuHandlers = useMemo(
    () => ({
      run: (a: Parameters<typeof run>[0], ids: number[]) => void run(a, ids),
      snooze: openSnooze,
      move: openMovePicker,
      openDraft: (i: ThreadListItem) => void openDraftRow(i, toast.show),
      deleteDraft: onTrash,
      reply: (i: ThreadListItem, m: "reply" | "replyAll" | "forward") => replyTo(i.id, m),
      block: (i: ThreadListItem) => {
        const sender = i.participants.find((p) => p.name.toLowerCase() !== "me");
        if (sender) void flint.blockSender(sender.address).then(() => run({ type: "archive" }, [i.id]));
      },
    }),
    [run, toast.show, onTrash],
  );

  if (pending) return <div className={styles.fill}>{showSkeleton ? <SkeletonRows count={12} density={density} rowHeight={threadH} /> : null}</div>;
  if (status === "error" && rows.length === 0) {
    return (
      <div className={styles.fill}>
        <EmptyState title="Couldn't load mail" description={error ?? undefined} action={<Button variant="ghost" onClick={() => void listStore.getState().refresh()}>Try again</Button>} markSize={48} />
      </div>
    );
  }
  if (rows.length === 0) {
    if (olderOnServer || serverSearch !== "idle" || loadingOlder) return <div className={styles.fill}><ListFooter empty /></div>;
    const copy = emptyCopy(nav);
    return <div className={styles.fill}><EmptyState title={copy.title} description={copy.description} markSize={48} /></div>;
  }

  const stickyLabel = stickyAt >= 0 ? rows[stickyAt] : undefined;
  const inboxLike = INBOX_LIKE.has(nav.view);

  return (
    <div ref={scrollRef} className={clsx(styles.scroll, stale && styles.stale)} onScroll={onScroll} role="listbox" aria-label="Conversations" aria-multiselectable aria-busy={stale || undefined} inert={stale || undefined}>
      {stickyLabel?.kind === "label" ? <div className={clsx("t-label", styles.sticky)} aria-hidden>{stickyLabel.label}</div> : null}
      <div className={styles.canvas} style={{ height: virt.getTotalSize() }}>
        {items.map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          const style = { height: v.size, transform: `translateY(${v.start}px)` };
          if (row.kind === "label") {
            return <div key={row.key} className={clsx("t-label", styles.label)} style={style}>{row.label}</div>;
          }
          if (row.kind === "bundle") {
            return (
              <div key={row.key} className={styles.row} style={style}>
                <BundleRow bundle={row.bundle} compact={compact} cursor={nav.cursorKey === row.key} now={now} onOpen={onBundle} />
              </div>
            );
          }
          const item = row.item;
          const inSelection = nav.selected.includes(item.id);
          const ids = inSelection ? nav.selected : [item.id];
          return (
            <div key={row.key} className={styles.row} style={style}>
              <ContextMenu className={styles.fill} items={rowMenuItems(item, ids, menuHandlers, inboxLike)}>
                <ThreadRow
                  item={item}
                  compact={compact}
                  previewLines={previewLines}
                  avatars={avatars !== "off"}
                  accountColor={showAccountColor ? colors.get(item.accountId) ?? null : null}
                  open={nav.openId === item.id}
                  cursor={nav.cursorKey === row.key}
                  checked={inSelection}
                  now={now}
                  onSelect={onSelect}
                  onPin={onPin}
                  onArchive={onArchive}
                  onTrash={onTrash}
                  onSnooze={onSnooze}
                />
              </ContextMenu>
            </div>
          );
        })}
      </div>
      <ListFooter />
    </div>
  );
}
