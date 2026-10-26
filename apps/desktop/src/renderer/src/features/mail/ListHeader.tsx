import { useCallback, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, Focus, ListFilter, MoreHorizontal, PenSquare, Search, SquareCheck } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import type { ThreadId } from "@flint/core";
import { Button, Dialog, IconButton, Menu, useToast } from "../../ui";
import type { MenuItem } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { useApp } from "../../state/AppContext";
import { attachmentsFilterable, filterable, navStore, useNav, type ListFilter as Filter } from "../../state/nav";
import { useThreadActions } from "../../state/useActions";
import { CATEGORY_TITLES, viewSubtitle, viewTitle } from "../../state/viewMeta";
import { BundleSummary, isBundleCategory } from "../ai/BundleSummary";
import { BUNDLE_CONFIRM_OVER, bundleThreadIds, compose, selectAll } from "./mailCommands";
import styles from "./ListHeader.module.css";

const SCOPED_VIEWS = new Set(["inbox", "pinned", "drafts", "sent", "trash", "archive", "snoozed", "spam", "blocked"]);
const ICON = { size: 16, strokeWidth: 1.5 } as const;

type BundleCategory = "notifications" | "newsletters";
export type BundleTriage = "read" | "archive";
type Pending = { category: BundleCategory; kind: BundleTriage; ids: ThreadId[] };

/**
 * "Mark all as read" and "Archive all" for a Notifications or Newsletters bundle, from its list header or its row.
 * Reads every conversation in the bundle (not only the rows loaded), asks first above 50, and runs the usual thread
 * action so Undo works. Render `dialog` once wherever the hook is used.
 */
export function useBundleTriage(): { triage: (category: BundleCategory, kind: BundleTriage) => Promise<void>; dialog: ReactNode } {
  const { run } = useThreadActions();
  const toast = useToast();
  const [pending, setPending] = useState<Pending | null>(null);

  const apply = useCallback((p: Pending) => void (p.kind === "read" ? run({ type: "read", read: true }, p.ids) : run({ type: "archive" }, p.ids)), [run]);
  const triage = useCallback(async (category: BundleCategory, kind: BundleTriage) => {
    let ids: ThreadId[];
    try {
      ids = await bundleThreadIds(category, navStore.getState().accountId, kind === "read");
    } catch {
      toast.show({ message: `Couldn't read ${CATEGORY_TITLES[category]}. Try again.`, level: "error" });
      return;
    }
    if (ids.length === 0) return;
    if (ids.length > BUNDLE_CONFIRM_OVER) setPending({ category, kind, ids });
    else apply({ category, kind, ids });
  }, [apply, toast]);

  const verb = pending?.kind === "read" ? "Mark as read" : "Archive";
  const dialog = (
    <Dialog
      open={pending !== null}
      onClose={() => setPending(null)}
      title={pending ? `${pending.kind === "read" ? "Mark all as read" : "Archive all"} in ${CATEGORY_TITLES[pending.category]}?` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          <Button variant="primary" onClick={() => { if (pending) apply(pending); setPending(null); }}>{verb} {pending?.ids.length}</Button>
        </>
      }
    >
      <p className="t-body">
        {pending?.kind === "read"
          ? `${pending.ids.length} unread conversations will be marked as read.`
          : `${pending?.ids.length ?? 0} conversations will leave your inbox.`} You can undo this right after.
      </p>
    </Dialog>
  );
  return { triage, dialog };
}

const FILTER_LABELS: Record<Filter, string> = { all: "All conversations", unread: "Unread", attachments: "Has attachments" };

export function ListHeader() {
  const { accounts, sidebar, settings, updateSettings } = useApp();
  const nav = useNav(useShallow((s) => ({
    view: s.view, accountId: s.accountId, folderId: s.folderId, category: s.category, search: s.search, searchOpen: s.searchOpen, listFilter: s.listFilter,
  })));
  const { triage, dialog } = useBundleTriage();
  const folders = sidebar?.accounts.flatMap((a) => a.folders) ?? [];
  const focused = settings.inbox.focused;
  const title = viewTitle(nav, folders);
  const subtitle = viewSubtitle(nav, focused, accounts);
  const scoped = accounts.length > 1 && SCOPED_VIEWS.has(nav.view) && !(nav.searchOpen && nav.search.trim());
  const bundle = isBundleCategory(nav.category) ? nav.category : null;

  const scopeItems: MenuItem[] = [
    { id: "all", label: "All accounts", checked: nav.accountId === undefined, onSelect: () => navStore.getState().go({ view: nav.view }) },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.email,
      checked: nav.accountId === a.id,
      onSelect: () => navStore.getState().go({ view: nav.view, accountId: a.id }),
    })),
  ];

  const filters: Filter[] = attachmentsFilterable(nav) ? ["all", "unread", "attachments"] : ["all", "unread"];
  const filterItems: MenuItem[] = filters.map((f) => ({
    id: `filter-${f}`, label: FILTER_LABELS[f], checked: nav.listFilter === f, shortcut: f === "unread" ? "shift+u" : undefined,
    onSelect: () => navStore.getState().setListFilter(f),
  }));
  const bundleItems: MenuItem[] = bundle
    ? [
        { id: "read-all", label: "Mark all as read", onSelect: () => void triage(bundle, "read") },
        { id: "archive-all", label: "Archive all", onSelect: () => void triage(bundle, "archive") },
      ]
    : [];

  const heading = scoped ? (
    <Menu
      items={scopeItems}
      trigger={
        <button type="button" className={clsx(styles.titleBtn, "no-drag")} aria-label={`${title}, choose account`}>
          <span className="t-title">{title}</span>
          <ChevronDown size={14} strokeWidth={1.5} color="var(--fg-3)" />
        </button>
      }
    />
  ) : null;

  return (
    <PaneHeader
      title={scoped ? undefined : title}
      subtitle={scoped ? undefined : subtitle}
      leading={
        <>
          {nav.category ? (
            <IconButton label="Back to Inbox" shortcut="Escape" className="no-drag" onClick={() => navStore.getState().closeCategory()}>
              <ChevronLeft {...ICON} />
            </IconButton>
          ) : null}
          {scoped ? (
            <div className={styles.scoped}>
              {heading}
              <span className={clsx("t-body", styles.subtitle)}>{subtitle}</span>
            </div>
          ) : null}
        </>
      }
    >
      {nav.view === "inbox" && !nav.category ? (
        <IconButton label={focused ? "Focused inbox on" : "Focused inbox off"} pressed={focused} onClick={() => void updateSettings({ inbox: { focused: !focused } })}>
          <Focus {...ICON} />
        </IconButton>
      ) : null}
      {bundle ? <BundleSummary category={bundle} /> : null}
      {bundle ? <Menu items={bundleItems} placement="bottom-end" trigger={<IconButton label={`More for ${CATEGORY_TITLES[bundle]}`}><MoreHorizontal {...ICON} /></IconButton>} /> : null}
      {filterable(nav) ? (
        <Menu
          items={filterItems}
          placement="bottom-end"
          trigger={
            <IconButton label={nav.listFilter === "all" ? "Filter" : `Filter: ${FILTER_LABELS[nav.listFilter]}`} pressed={nav.listFilter !== "all"}>
              <ListFilter {...ICON} />
            </IconButton>
          }
        />
      ) : null}
      <IconButton label="Select all" shortcut="mod+a" onClick={selectAll}>
        <SquareCheck {...ICON} />
      </IconButton>
      <IconButton label="Search" shortcut="/" pressed={nav.searchOpen} onClick={() => (nav.searchOpen ? navStore.getState().closeSearch() : navStore.getState().openSearch())}>
        <Search {...ICON} />
      </IconButton>
      <IconButton label="Compose" shortcut="c" tone="accent" onClick={compose}>
        <PenSquare {...ICON} />
      </IconButton>
      {dialog}
    </PaneHeader>
  );
}
