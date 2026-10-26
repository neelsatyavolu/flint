import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import type { AccountId, Bundle, SidebarAccount, ThreadListItem } from "@flint/core";
import { ContextMenu, EmptyState, SkeletonRows, Button } from "../../ui";
import type { MenuItem } from "../../ui";
import { useApp } from "../../state/AppContext";
import { groupByDate, rangeIds } from "../../state/grouping";
import { listStore, useList } from "../../state/listStore";
import { filterable, navStore, useNav, type ListFilter } from "../../state/nav";
import { LABEL_ROW_HEIGHT, rowHeight } from "../../state/rowMetrics";
import { emptyCopy } from "../../state/viewMeta";
import { useThreadActions } from "../../state/useActions";
import { describeEvent, detectMac } from "../../lib/shortcuts";
import { BundleRow } from "./BundleRow";
import { ListFooter } from "./ListFooter";
import { useBundleTriage } from "./ListHeader";
import { ThreadRow, rowDomId } from "./ThreadRow";
import { blockRowSender, deleteDraftRow, openDraftRow, openMovePicker, openSnooze, replyTo, selectAll } from "./mailCommands";
import { rowMenuItems } from "./rowMenu";
import { activeLabelIndex, rowOffsets } from "./stickyLabel";
import { useToast } from "../../ui/Toast";
import styles from "./ThreadList.module.css";

const OVERSCAN = 8;
/** A list that loads faster than this never shows its skeleton, so quick view changes do not flash. */
const SKELETON_DELAY_MS = 140;
/** Drag payload: a JSON array of thread ids. The sidebar's folder and mailbox rows accept it. */
export const THREADS_MIME = "application/x-flint-threads";

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

const FILTER_EMPTY: Record<Exclude<ListFilter, "all">, string> = { unread: "No unread mail here.", attachments: "No attachments here." };

/**
 * An account in scope that is still on its first sync (it has never finished one), with how far along it is.
 * The list is empty only because mail has not arrived yet, so the empty state says that instead of "Inbox zero."
 */
export function firstSyncProgress(accounts: SidebarAccount[], accountId: AccountId | undefined): { done: number; total: number } | null {
  const syncing = accounts.filter((a) => (accountId === undefined || a.account.id === accountId) && a.sync.state === "syncing" && !a.sync.lastSyncAt);
  if (syncing.length === 0) return null;
  return syncing.reduce((sum, a) => ({ done: sum.done + (a.sync.progress?.done ?? 0), total: sum.total + (a.sync.progress?.total ?? 0) }), { done: 0, total: 0 });
}

/** Sets the drag payload (the selection, or just this row) and a small "N conversations" drag image. */
function startDrag(item: ThreadListItem, e: DragEvent) {
  const { selected } = navStore.getState();
  // Local-only drafts carry negative ids: they are not conversations and cannot be moved.
  const ids = (selected.includes(item.id) ? selected : [item.id]).filter((id) => id > 0);
  if (ids.length === 0) {
    e.preventDefault();
    return;
  }
  e.dataTransfer.setData(THREADS_MIME, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "move";
  const ghost = document.createElement("div");
  ghost.className = clsx("t-body", styles.dragImage);
  ghost.textContent = ids.length === 1 ? "1 conversation" : `${ids.length} conversations`;
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, 12, 14);
  setTimeout(() => ghost.remove(), 0);
}

/** Opens the row menu from the keyboard: a contextmenu event at the cursor row, as a right-click there would send. */
function openRowMenu(cursorKey: string | null): boolean {
  const el = cursorKey ? document.getElementById(rowDomId(cursorKey)) : null;
  if (!el) return false;
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2 }));
  return true;
}

export function ThreadList() {
  const { settings, accounts, sidebar } = useApp();
  const nav = useNav(useShallow((s) => ({
    view: s.view, accountId: s.accountId, folderId: s.folderId, category: s.category, search: s.search, searchOpen: s.searchOpen,
    openId: s.openId, cursorKey: s.cursorKey, selected: s.selected, listFilter: s.listFilter,
  })));
  const entries = useList((s) => s.entries);
  const status = useList((s) => s.status);
  const stale = useList((s) => s.stale);
  const error = useList((s) => s.error);
  const pageError = useList((s) => s.pageError);
  const hasMore = useList((s) => s.nextCursor !== null);
  const serverSearch = useList((s) => s.serverSearch);
  const loadingOlder = useList((s) => s.loadingOlder);
  const olderOnServer = useList((s) => s.olderOnServer);
  const listKey = useList((s) => s.queryKey);
  const autoOlder = useRef<string | null>(null);
  const { run } = useThreadActions();
  const toast = useToast();
  const { triage, dialog } = useBundleTriage();
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
    if (hasMore && !pageError && rows.length > 0 && lastVisible >= rows.length - LOAD_AHEAD) void listStore.getState().loadMore();
  }, [hasMore, pageError, lastVisible, rows.length]);

  // Reaching the end of what is local pulls one batch of older mail by itself; after that the footer asks.
  useEffect(() => {
    if (hasMore || !olderOnServer || status !== "ready" || listKey === null || autoOlder.current === listKey) return;
    if (rows.length > 0 && lastVisible < rows.length - 1) return;
    autoOlder.current = listKey;
    void listStore.getState().loadOlder();
  }, [hasMore, olderOnServer, status, listKey, rows.length, lastVisible]);

  // The scroller stays mounted across lists that paint from memory: a list seen before comes back where it was left,
  // a new one starts at the top.
  useEffect(() => {
    const place = listStore.getState().restored;
    if (scrollRef.current) scrollRef.current.scrollTop = place?.scrollTop ?? 0;
    if (place?.cursorKey && navStore.getState().cursorKey === null) navStore.getState().setCursor(place.cursorKey);
  }, [listKey]);

  const onScroll = useCallback(() => {
    const top = scrollRef.current?.scrollTop ?? 0;
    const next = activeLabelIndex(labelIdx, offsets, top);
    setStickyAt((cur) => (cur === next ? cur : next));
    listStore.getState().savePlace({ scrollTop: top });
  }, [labelIdx, offsets]);
  useEffect(onScroll, [onScroll]);

  useEffect(() => {
    if (!nav.cursorKey) return;
    const at = rows.findIndex((r) => r.key === nav.cursorKey);
    if (at === -1) return;
    virt.scrollToIndex(at, { align: "auto" });
    // Navigating away clears the cursor first; only a cursor on this list's rows is worth remembering.
    listStore.getState().savePlace({ cursorKey: nav.cursorKey });
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

  const onCheck = useCallback((item: ThreadListItem) => {
    const n = navStore.getState();
    // A checkbox picks just this row: unlike Cmd-click, it does not pull the open thread into the selection.
    n.setSelected(n.selected.includes(item.id) ? n.selected.filter((id) => id !== item.id) : [...n.selected, item.id]);
    n.setCursor(`t${item.id}`);
  }, []);

  const onBundle = useCallback((b: Bundle) => navStore.getState().openCategory(b.category), []);
  const onTriage = useCallback((b: Bundle, kind: "read" | "archive") => void triage(b.category, kind), [triage]);
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
      block: (i: ThreadListItem) => void blockRowSender(i, toast.show, (ids) => run({ type: "archive" }, ids)),
    }),
    [run, toast.show, onTrash],
  );
  const bundleMenu = useCallback((b: Bundle): MenuItem[] => [
    { id: "open", label: "Open", shortcut: "↵", onSelect: () => onBundle(b) },
    { type: "separator", id: "s1" },
    { id: "read-all", label: "Mark all as read", disabled: b.unreadCount === 0, onSelect: () => onTriage(b, "read") },
    { id: "archive-all", label: "Archive all", onSelect: () => onTriage(b, "archive") },
  ], [onBundle, onTriage]);

  // Both handlers act only on the listbox itself: focus and keys from a row checkbox, or from a menu or dialog that
  // React bubbles up through its portal, are not the list's.
  const onFocus = useCallback((e: FocusEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const n = navStore.getState();
    const first = listStore.getState().entries[0];
    if (n.cursorKey === null && n.openId === null && first) n.setCursor(first.key);
  }, []);

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const combo = describeEvent(e.nativeEvent, detectMac());
    const n = navStore.getState();
    let handled = true;
    if (combo === "mod+a") selectAll();
    else if (combo === "shift+u" && filterable(n)) n.setListFilter(n.listFilter === "unread" ? "all" : "unread");
    else if (combo === "shift+F10" || combo === "ContextMenu") handled = openRowMenu(n.cursorKey ?? (n.openId !== null ? `t${n.openId}` : null));
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

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
    const filtered = nav.listFilter !== "all" && filterable(nav);
    const syncing = !filtered && !(nav.searchOpen && nav.search.trim()) ? firstSyncProgress(sidebar?.accounts ?? [], nav.accountId) : null;
    if (syncing) {
      const pct = syncing.total > 0 ? Math.min(100, Math.round((syncing.done / syncing.total) * 100)) : null;
      return (
        <div className={styles.fill}>
          <EmptyState
            title="Getting your mail…"
            description={pct === null ? "Your first sync has started." : `${syncing.done.toLocaleString()} of ${syncing.total.toLocaleString()} messages`}
            action={pct === null ? undefined : <div className={styles.progress} role="progressbar" aria-label="First sync" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>}
            markSize={48}
          />
        </div>
      );
    }
    const copy = filtered ? { title: FILTER_EMPTY[nav.listFilter as Exclude<ListFilter, "all">] } : emptyCopy(nav);
    return (
      <div className={styles.fill}>
        <EmptyState
          title={copy.title}
          description={"description" in copy ? copy.description : undefined}
          action={filtered ? <Button variant="ghost" onClick={() => navStore.getState().setListFilter("all")}>Show all</Button> : undefined}
          markSize={48}
        />
      </div>
    );
  }

  const stickyLabel = stickyAt >= 0 ? rows[stickyAt] : undefined;
  const inboxLike = INBOX_LIKE.has(nav.view);
  const selecting = nav.selected.length > 0;
  const activeKey = nav.cursorKey ?? (nav.openId !== null ? `t${nav.openId}` : null);
  const activeShown = activeKey !== null && rows.some((r) => r.key === activeKey);

  return (
    <div
      ref={scrollRef}
      className={clsx(styles.scroll, stale && styles.stale)}
      onScroll={onScroll}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      role="listbox"
      tabIndex={0}
      aria-label="Conversations"
      aria-multiselectable
      aria-activedescendant={activeShown ? rowDomId(activeKey) : undefined}
      aria-busy={stale || undefined}
      inert={stale || undefined}
    >
      {stickyLabel?.kind === "label" ? <div className={clsx("t-label", styles.sticky)} role="presentation" aria-hidden>{stickyLabel.label}</div> : null}
      <div className={styles.canvas} style={{ height: virt.getTotalSize() }}>
        {items.map((v) => {
          const row = rows[v.index];
          if (!row) return null;
          const style = { height: v.size, transform: `translateY(${v.start}px)` };
          if (row.kind === "label") {
            return <div key={row.key} className={clsx("t-label", styles.label)} style={style} role="presentation">{row.label}</div>;
          }
          if (row.kind === "bundle") {
            return (
              <div key={row.key} className={styles.row} style={style}>
                <ContextMenu className={styles.fill} items={bundleMenu(row.bundle)}>
                  <BundleRow bundle={row.bundle} compact={compact} cursor={nav.cursorKey === row.key} now={now} onOpen={onBundle} onTriage={onTriage} />
                </ContextMenu>
              </div>
            );
          }
          const item = row.item;
          const inSelection = nav.selected.includes(item.id);
          const ids = inSelection ? nav.selected : [item.id];
          return (
            <div key={row.key} className={styles.row} style={style}>
              <ContextMenu className={styles.fill} items={rowMenuItems(item, ids, menuHandlers, inboxLike, nav.view)}>
                <ThreadRow
                  item={item}
                  compact={compact}
                  previewLines={previewLines}
                  avatars={avatars !== "off"}
                  accountColor={showAccountColor ? colors.get(item.accountId) ?? null : null}
                  open={nav.openId === item.id}
                  cursor={nav.cursorKey === row.key}
                  checked={inSelection}
                  selecting={selecting}
                  now={now}
                  onSelect={onSelect}
                  onCheck={onCheck}
                  onDragStart={startDrag}
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
      {/* Room for the floating Ask field, so it never covers the last rows. */}
      <div className={styles.clearance} aria-hidden />
      {dialog}
    </div>
  );
}
