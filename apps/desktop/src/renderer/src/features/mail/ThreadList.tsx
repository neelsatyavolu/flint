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
import { ThreadRow } from "./ThreadRow";
import { openDraftThread, openMovePicker, openSnooze, replyTo } from "./mailCommands";
import { rowMenuItems } from "./rowMenu";
import { activeLabelIndex, rowOffsets } from "./stickyLabel";
import { flint } from "../../lib/api";
import styles from "./ThreadList.module.css";

const OVERSCAN = 8;
const LOAD_AHEAD = 12;
const INBOX_LIKE = new Set(["inbox", "snoozed", "pinned", "drafts", "sent", "folder", "search"]);

export function ThreadList() {
  const { settings, accounts } = useApp();
  const nav = useNav((s) => s);
  const entries = useList((s) => s.entries);
  const status = useList((s) => s.status);
  const error = useList((s) => s.error);
  const hasMore = useList((s) => s.nextCursor !== null);
  const { run } = useThreadActions();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [stickyAt, setStickyAt] = useState(-1);

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
      void openDraftThread(item.id);
    } else {
      n.openThread(item.id);
    }
  }, []);

  const onBundle = useCallback((b: Bundle) => navStore.getState().openCategory(b.category), []);
  const onPin = useCallback((i: ThreadListItem) => void run({ type: "pin", pinned: !i.pinned }, [i.id]), [run]);
  const onArchive = useCallback((i: ThreadListItem) => void run({ type: "archive" }, [i.id]), [run]);
  const onTrash = useCallback((i: ThreadListItem) => void run({ type: "trash" }, [i.id]), [run]);
  const onSnooze = useCallback((i: ThreadListItem) => openSnooze([i.id]), []);
  const menuHandlers = useMemo(
    () => ({
      run: (a: Parameters<typeof run>[0], ids: number[]) => void run(a, ids),
      snooze: openSnooze,
      move: openMovePicker,
      reply: (i: ThreadListItem, m: "reply" | "replyAll" | "forward") => replyTo(i.id, m),
      block: (i: ThreadListItem) => {
        const sender = i.participants.find((p) => p.name.toLowerCase() !== "me");
        if (sender) void flint.blockSender(sender.address).then(() => run({ type: "archive" }, [i.id]));
      },
    }),
    [run],
  );

  if (status === "loading" && rows.length === 0) return <div className={styles.fill}><SkeletonRows count={9} density={density} /></div>;
  if (status === "error" && rows.length === 0) {
    return (
      <div className={styles.fill}>
        <EmptyState title="Couldn't load mail" description={error ?? undefined} action={<Button variant="ghost" onClick={() => void listStore.getState().refresh()}>Try again</Button>} markSize={48} />
      </div>
    );
  }
  if (rows.length === 0) {
    const copy = emptyCopy(nav);
    return <div className={styles.fill}><EmptyState title={copy.title} description={copy.description} markSize={48} /></div>;
  }

  const stickyLabel = stickyAt >= 0 ? rows[stickyAt] : undefined;
  const inboxLike = INBOX_LIKE.has(nav.view);

  return (
    <div ref={scrollRef} className={styles.scroll} onScroll={onScroll} role="listbox" aria-label="Conversations" aria-multiselectable>
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
    </div>
  );
}
