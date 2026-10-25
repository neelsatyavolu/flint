import { ChevronDown, ChevronLeft, Focus, PenSquare, Search } from "lucide-react";
import clsx from "clsx";
import { IconButton, Menu } from "../../ui";
import type { MenuItem } from "../../ui";
import { PaneHeader } from "../../shell/PaneHeader";
import { useApp } from "../../state/AppContext";
import { navStore, useNav } from "../../state/nav";
import { viewSubtitle, viewTitle } from "../../state/viewMeta";
import { compose } from "./mailCommands";
import styles from "./ListHeader.module.css";

const SCOPED_VIEWS = new Set(["inbox", "pinned", "drafts", "sent", "trash", "archive", "snoozed", "spam", "blocked"]);

export function ListHeader() {
  const { accounts, sidebar, settings, updateSettings } = useApp();
  const nav = useNav((s) => s);
  const folders = sidebar?.accounts.flatMap((a) => a.folders) ?? [];
  const focused = settings.inbox.focused;
  const title = viewTitle(nav, folders);
  const subtitle = viewSubtitle(nav, focused, accounts);
  const scoped = accounts.length > 1 && SCOPED_VIEWS.has(nav.view) && !(nav.searchOpen && nav.search.trim());

  const scopeItems: MenuItem[] = [
    { id: "all", label: "All accounts", checked: nav.accountId === undefined, onSelect: () => navStore.getState().go({ view: nav.view }) },
    ...accounts.map((a) => ({
      id: a.id,
      label: a.email,
      checked: nav.accountId === a.id,
      onSelect: () => navStore.getState().go({ view: nav.view, accountId: a.id }),
    })),
  ];

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
              <ChevronLeft size={18} strokeWidth={1.5} />
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
          <Focus size={16} strokeWidth={1.5} />
        </IconButton>
      ) : null}
      <IconButton label="Search" shortcut="/" pressed={nav.searchOpen} onClick={() => (nav.searchOpen ? navStore.getState().closeSearch() : navStore.getState().openSearch())}>
        <Search size={16} strokeWidth={1.5} />
      </IconButton>
      <IconButton label="Compose" shortcut="c" tone="accent" onClick={compose}>
        <PenSquare size={18} strokeWidth={1.5} />
      </IconButton>
    </PaneHeader>
  );
}
