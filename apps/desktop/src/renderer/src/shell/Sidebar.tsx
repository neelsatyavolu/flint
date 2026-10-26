import { useMemo, type ReactNode } from "react";
import { Activity, Archive, Ban, CalendarClock, Clock, Eye, FileText, Folder, Home, Inbox, MoreHorizontal, PanelLeft, Pin, Send, Settings, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import clsx from "clsx";
import { useShallow } from "zustand/react/shallow";
import type { Account, Folder as MailFolder } from "@flint/core";
import { avatarColor, initials } from "../lib/avatar";
import { isMac } from "../lib/host";
import { Avatar, IconButton, useToast } from "../ui";
import { useApp } from "../state/AppContext";
import type { ThreadAction } from "../state/actions";
import { listStore } from "../state/listStore";
import { navStore, useNav, type NavTarget } from "../state/nav";
import { useThreadActions } from "../state/useActions";
import { isActiveTarget, moreFolders, sidebarCounts, syncSummary } from "../state/sidebarModel";
import { NavItem } from "./NavItem";
import { SyncButton } from "./SyncButton";
import styles from "./Sidebar.module.css";

const ICON = { size: 16, strokeWidth: 1.5 } as const;

/** The account's picture, or its generated avatar when it has none (the same source as Settings, Accounts). */
function AccountChip({ account }: { account: Account }) {
  return <Avatar address={account.email} name={account.name} accountId={account.id} size={16} className={styles.chip} />;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={clsx("t-label", styles.sectionHead)}>
        <span>{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

type Props = { rail: boolean; onNavigated?: () => void };

export function Sidebar({ rail, onNavigated }: Props) {
  const { sidebar, accounts, narrow } = useApp();
  const nav = useNav(
    useShallow((s) => ({ view: s.view, accountId: s.accountId, folderId: s.folderId, category: s.category, settingsOpen: s.settingsOpen, settingsSection: s.settingsSection, expanded: s.expanded, recents: s.recents })),
  );
  const { run } = useThreadActions();
  /** Drop handler for a row that files dragged conversations. */
  const dropAs = (action: ThreadAction) => (ids: number[]) => void run(action, ids);
  const toast = useToast();
  /** Drop handler for a folder row. Core moves mail only within its account, so conversations from another are refused. */
  const dropInFolder = (f: Pick<MailFolder, "id" | "name" | "accountId">) => (ids: number[]) => {
    const accountOf = new Map(listStore.getState().raw.map((i) => [i.id, i.accountId]));
    if (ids.some((id) => accountOf.get(id) !== f.accountId)) {
      toast.show({ message: `Couldn't move to ${f.name}: conversations only move to folders in their own account.`, level: "error" });
      return;
    }
    void run({ type: "move", folderId: f.id, folderName: f.name }, ids);
  };
  const counts = useMemo(() => sidebarCounts(sidebar), [sidebar]);
  const sync = useMemo(() => syncSummary(sidebar), [sidebar]);
  const multi = accounts.length > 1;

  const go = (target: NavTarget, label?: string) => {
    navStore.getState().go(target, label);
    onNavigated?.();
  };
  const active = (t: { view: string; accountId?: string; folderId?: number }) => !nav.settingsOpen && isActiveTarget(nav, t) && !nav.category;
  const openSettings = (section?: string) => {
    navStore.getState().openSettings(section);
    onNavigated?.();
  };
  const toggle = (key: string) => navStore.getState().toggleExpanded(key);
  const item = (view: NavTarget["view"], label: string, icon: ReactNode, count?: number, extra: Partial<React.ComponentProps<typeof NavItem>> = {}) => (
    <NavItem key={view} icon={icon} label={label} count={count} active={active({ view })} onClick={() => go({ view })} rail={rail} {...extra} />
  );

  const accountChildren = (view: NavTarget["view"], counted: boolean) =>
    accounts.map((a) => (
      <NavItem
        key={`${view}:${a.id}`}
        depth={1}
        icon={<AccountChip account={a} />}
        label={a.email}
        middleEllipsis
        count={counted ? counts.byAccount[a.id] : 0}
        active={active({ view, accountId: a.id })}
        onClick={() => go({ view, accountId: a.id }, view === "inbox" ? a.email : undefined)}
      />
    ));

  const showInboxChildren = multi && nav.expanded.inbox && !rail;
  const showTrashChildren = multi && nav.expanded.trash && !rail;
  const folders = sidebar?.accounts ?? [];
  const hasMoreFolders = folders.some((a) => moreFolders(a.folders).length > 0);

  return (
    <nav className={clsx(styles.sidebar, rail && styles.rail)} aria-label="Mailboxes">
      <div className={clsx(styles.header, "drag", isMac() && !rail && styles.macInset)}>
        {rail ? null : (
          <>
            <span className={styles.grow} />
            <SyncButton sync={sync} />
            <IconButton label="Hide sidebar" shortcut="mod+\\" className="no-drag" onClick={() => navStore.getState().toggleSidebar(narrow)}>
              <PanelLeft {...ICON} />
            </IconButton>
          </>
        )}
      </div>

      <div className={styles.scroll}>
        {rail ? (
          <div className={styles.railTools}>
            <IconButton label="Show sidebar" shortcut="mod+\\" tooltipPlacement="right" onClick={() => navStore.getState().toggleSidebar(true)}>
              <PanelLeft {...ICON} />
            </IconButton>
            <SyncButton sync={sync} />
          </div>
        ) : null}
        <div className={styles.group}>
          {item("home", "Home", <Home {...ICON} />, undefined, { shortcut: "g h" })}
          <NavItem
            icon={<Inbox {...ICON} />}
            label="Inbox"
            count={counts.inbox}
            active={active({ view: "inbox" })}
            expandable={multi}
            expanded={nav.expanded.inbox}
            onToggle={() => toggle("inbox")}
            onClick={() => go({ view: "inbox" })}
            rail={rail}
            shortcut="g i"
            onDropThreads={dropAs({ type: "inbox" })}
          />
          {showInboxChildren ? accountChildren("inbox", true) : null}
          {item("agent_activity", "Agent Activity", <Activity {...ICON} />, counts.awaitingApproval, { tone: "warn", countNoun: "awaiting approval" })}
          {item("pinned", "Pins", <Pin {...ICON} />, undefined, { shortcut: "g p" })}
          {item("drafts", "Drafts", <FileText {...ICON} />, counts.drafts, { shortcut: "g d", countNoun: "" })}
          {item("sent", "Sent", <Send {...ICON} />, undefined, { shortcut: "g s" })}
          {item("scheduled", "Scheduled", <CalendarClock {...ICON} />, counts.scheduled, { countNoun: "" })}
          {item("snoozed", "Snoozed", <Clock {...ICON} />, counts.snoozed, { countNoun: "" })}
          <NavItem
            icon={<Trash2 {...ICON} />}
            label="Trash"
            active={active({ view: "trash" })}
            expandable={multi}
            expanded={nav.expanded.trash}
            onToggle={() => toggle("trash")}
            onClick={() => go({ view: "trash" })}
            rail={rail}
            onDropThreads={dropAs({ type: "trash" })}
          />
          {showTrashChildren ? accountChildren("trash", false) : null}
          {item("spam", "Spam", <ShieldAlert {...ICON} />, counts.spam, { onDropThreads: dropAs({ type: "spam", spam: true }) })}
        </div>

        {rail ? <div className={styles.railRule} /> : null}
        <Section title="Folders">
          {item("archive", "Archive", <Archive {...ICON} />, undefined, { onDropThreads: dropAs({ type: "archive" }) })}
          {item("blocked", "Blocked", <Ban {...ICON} />)}
          {item("receipts", "Read Receipts", <Eye {...ICON} />)}
          <NavItem
            icon={<MoreHorizontal {...ICON} />}
            label="More"
            expandable={!rail && hasMoreFolders}
            expanded={nav.expanded.more}
            onToggle={() => toggle("more")}
            onClick={() => toggle("more")}
            rail={rail}
          />
          {nav.expanded.more && !rail
            ? folders.map((a) => {
                const list = moreFolders(a.folders);
                if (list.length === 0) return null;
                return (
                  <div key={a.account.id}>
                    {multi ? <div className={clsx("t-data", styles.acctLabel)}>{a.account.email}</div> : null}
                    {list.map((f) => (
                      <NavItem
                        key={f.id}
                        depth={1}
                        icon={<Folder {...ICON} />}
                        label={f.name}
                        count={f.unread}
                        active={active({ view: "folder", accountId: f.accountId, folderId: f.id })}
                        onClick={() => go({ view: "folder", accountId: f.accountId, folderId: f.id }, f.name)}
                        onDropThreads={dropInFolder(f)}
                      />
                    ))}
                  </div>
                );
              })
            : null}
        </Section>

        {!rail && nav.recents.length ? (
          <Section
            title="Recents"
            action={<button type="button" className={clsx("t-data", styles.clear)} onClick={() => navStore.getState().clearRecents()}>Clear</button>}
          >
            {nav.recents.map((r) => (
              <NavItem
                key={r.id}
                icon={<Folder {...ICON} />}
                label={r.label}
                active={active({ view: r.view, accountId: r.accountId, folderId: r.folderId })}
                onClick={() => go({ view: r.view, accountId: r.accountId, folderId: r.folderId })}
              />
            ))}
          </Section>
        ) : null}
      </div>

      <div className={styles.footer}>
        <NavItem icon={<Sparkles {...ICON} />} label="Agents & CLI" active={nav.settingsOpen && nav.settingsSection === "agents"} onClick={() => openSettings("agents")} rail={rail} />
        <NavItem icon={<Settings {...ICON} />} label="Settings" active={nav.settingsOpen && nav.settingsSection !== "agents"} onClick={() => openSettings()} rail={rail} shortcut="mod+," />
      </div>
    </nav>
  );
}
