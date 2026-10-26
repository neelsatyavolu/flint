import type { ReactNode } from "react";
import {
  Activity, Archive, Bell, BellOff, Ban, CalendarClock, Clock, Eye, FileText, Folder, FolderInput, Forward, Home, Inbox, Keyboard, LayoutPanelLeft, Mail, Monitor, Moon,
  Newspaper, PanelLeft, PenSquare, Pin, RefreshCw, Reply, ReplyAll, Search, Send, Settings as SettingsIcon, ShieldAlert, Sparkles, Sun, Trash2, Undo2, UserRound, Users,
} from "lucide-react";
import type { Account, Category, DeepPartial, Folder as FolderRow, Settings, SidebarData, Template } from "@flint/core";
import { flint } from "../../lib/api";
import { formatPresetTime, resolvePresets } from "../../lib/time";
import type { AppCommands } from "../../shell/useAppCommands";
import type { ThreadAction } from "../../state/actions";
import { navStore, type NavTarget } from "../../state/nav";
import { moreFolders } from "../../state/sidebarModel";
import { CATEGORY_TITLES } from "../../state/viewMeta";
import { openAsk } from "../ai/events";
import { sendComposerCommand } from "./composerBridge";
import type { Range } from "./fuzzy";

export type Kind = "action" | "go" | "folder" | "settings" | "toggle" | "option" | "mail" | "contact" | "ask" | "search";
export type PageId = "snooze" | "move" | "category" | "template" | "from" | "theme" | "layout";

export type Entry = {
  id: string;
  label: string;
  group: string;
  kind: Kind;
  keywords?: string;
  icon?: ReactNode;
  shortcut?: string;
  /** Right-aligned text in Geist Mono: a resolved time, a current value. */
  hint?: string;
  /** Quieter text after the label: a sender, an address. */
  detail?: string;
  /** Only found by typing; left out of the empty-query list. */
  quiet?: boolean;
  checked?: boolean;
  bold?: boolean;
  /** Opens a nested page instead of running. */
  page?: PageId;
  run?: () => void;
};
export type Row = Entry & { ranges: Range[] };

export type PaletteEnv = {
  cmds: AppCommands;
  accounts: Account[];
  sidebar: SidebarData | undefined;
  settings: Settings;
  update: (patch: DeepPartial<Settings>, message: string) => void;
  /** How many conversations thread actions apply to (0 when there is no target). */
  count: number;
  category: Category | null;
  moveFolders: FolderRow[];
  run: (action: ThreadAction) => void;
  composer: { id: string } | null;
  templates: Template[];
  fromOptions: { address: string; alias: boolean }[];
  now: number;
};

const I = { size: 15, strokeWidth: 1.5 } as const;
const CATEGORIES: Category[] = ["people", "notifications", "newsletters"];
const CATEGORY_ICON: Record<Category, ReactNode> = { people: <Users {...I} />, notifications: <Bell {...I} />, newsletters: <Newspaper {...I} /> };

export const PAGE_TITLES: Record<PageId, string> = {
  snooze: "Snooze until", move: "Move to folder", category: "Move to category", template: "Insert template", from: "Send from", theme: "Theme", layout: "Layout",
};

const VIEWS: { label: string; target: NavTarget; icon: ReactNode; shortcut?: string; keywords?: string }[] = [
  { label: "Home", target: { view: "home" }, icon: <Home {...I} />, shortcut: "g h" },
  { label: "Inbox", target: { view: "inbox" }, icon: <Inbox {...I} />, shortcut: "g i", keywords: "all mail unified" },
  { label: "Agent Activity", target: { view: "agent_activity" }, icon: <Activity {...I} />, keywords: "ai log" },
  { label: "Pins", target: { view: "pinned" }, icon: <Pin {...I} />, shortcut: "g p", keywords: "pinned starred" },
  { label: "Drafts", target: { view: "drafts" }, icon: <FileText {...I} />, shortcut: "g d" },
  { label: "Sent", target: { view: "sent" }, icon: <Send {...I} />, shortcut: "g s" },
  { label: "Scheduled", target: { view: "scheduled" }, icon: <CalendarClock {...I} />, keywords: "send later" },
  { label: "Snoozed", target: { view: "snoozed" }, icon: <Clock {...I} /> },
  { label: "Trash", target: { view: "trash" }, icon: <Trash2 {...I} />, keywords: "deleted bin" },
  { label: "Archive", target: { view: "archive" }, icon: <Archive {...I} />, keywords: "done" },
  { label: "Blocked", target: { view: "blocked" }, icon: <Ban {...I} /> },
  { label: "Read Receipts", target: { view: "receipts" }, icon: <Eye {...I} />, keywords: "receipts opened tracking" },
];

const SETTINGS_SECTIONS: { id: string; label: string; keywords?: string }[] = [
  { id: "general", label: "General" }, { id: "accounts", label: "Accounts", keywords: "email add" }, { id: "appearance", label: "Appearance", keywords: "theme layout density avatars" },
  { id: "inbox", label: "Inbox", keywords: "focused sort archive" }, { id: "signatures", label: "Signatures" }, { id: "templates", label: "Templates", keywords: "snippets" },
  { id: "rules", label: "Rules", keywords: "filters" }, { id: "receipts", label: "Read Receipts", keywords: "tracking" }, { id: "notifications", label: "Notifications", keywords: "alerts sound badge" },
  { id: "ai", label: "+AI", keywords: "assistant model chatgpt grok" }, { id: "agents", label: "Agents", keywords: "cli claude codex" }, { id: "shortcuts", label: "Shortcuts", keywords: "keys" },
  { id: "blocked", label: "Blocked", keywords: "senders" }, { id: "about", label: "About", keywords: "version update" },
];
export const AI_SETTINGS_PAGES = ["personalization", "writing", "automation", "translation", "assistant"] as const;
export const SETTINGS_SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function actionEntries(env: PaletteEnv): Entry[] {
  const { cmds, count } = env;
  const a = (id: string, label: string, icon: ReactNode, run: () => void, shortcut?: string, keywords?: string, extra: Partial<Entry> = {}): Entry => ({ id, label, icon, run, shortcut, keywords, group: "Actions", kind: "action", ...extra });
  const single = count === 1;
  const out: Entry[] = [
    a("archive", "Archive", <Archive {...I} />, cmds.archive, "e", "done"),
    a("trash", "Move to Trash", <Trash2 {...I} />, cmds.trash, "#", "delete remove"),
    a("pin", "Pin or unpin", <Pin {...I} />, cmds.togglePin, "s", "star"),
    a("snooze", "Snooze", <Clock {...I} />, () => undefined, "h", "later remind defer", { page: "snooze" }),
    a("move", "Move to folder", <FolderInput {...I} />, () => undefined, "v", "label file", { page: "move" }),
    a("category", "Move to category", <Mail {...I} />, () => undefined, undefined, "people notifications newsletters recategorize file", { page: "category" }),
    a("read", "Mark read or unread", <Mail {...I} />, cmds.toggleRead, "u"),
  ];
  if (single) {
    out.push(
      a("reply", "Reply", <Reply {...I} />, () => cmds.reply("reply"), "r"),
      a("replyAll", "Reply all", <ReplyAll {...I} />, () => cmds.reply("replyAll"), "a"),
      a("forward", "Forward", <Forward {...I} />, () => cmds.reply("forward"), "f"),
    );
  }
  out.push(
    a("mute", "Mute conversation", <BellOff {...I} />, cmds.toggleMute, "m", "silence"),
    a("spam", "Mark as spam", <ShieldAlert {...I} />, cmds.spam, "!", "junk"),
  );
  for (const p of resolvePresets(env.now)) {
    out.push(a(`snooze:${p.id}`, `Snooze until ${p.label.toLowerCase()}`, <Clock {...I} />, () => env.run({ type: "snooze", until: p.at }), undefined, "later remind", { quiet: true, hint: formatPresetTime(p.at, env.now) }));
  }
  for (const c of CATEGORIES.filter((x) => x !== env.category)) {
    out.push(a(`category:${c}`, `Move to ${CATEGORY_TITLES[c]}`, CATEGORY_ICON[c], () => env.run({ type: "category", category: c }), undefined, "category recategorize file", { quiet: true }));
  }
  return out;
}

function appEntries(env: PaletteEnv): Entry[] {
  const { cmds } = env;
  const n = () => navStore.getState();
  const app = (id: string, label: string, icon: ReactNode, run: () => void, shortcut?: string, keywords?: string): Entry => ({ id, label, icon, run, shortcut, keywords, group: "App", kind: "action" });
  const out = [
    app("compose", "New message", <PenSquare {...I} />, cmds.compose, "c", "write email"),
    app("search", "Search mail", <Search {...I} />, () => n().openSearch(), "/", "find"),
    app("ask", "Ask AI", <Sparkles {...I} />, () => openAsk(), undefined, "question assistant chat"),
    app("sync", "Sync now", <RefreshCw {...I} />, () => void flint.syncNow(), undefined, "refresh fetch"),
    app("undo", "Undo last action", <Undo2 {...I} />, cmds.undo, "mod+shift+z"),
    app("sidebar", "Show or hide sidebar", <PanelLeft {...I} />, cmds.toggleSidebar, "mod+\\"),
    app("settings", "Settings", <SettingsIcon {...I} />, () => n().openSettings(), "mod+,", "preferences options"),
    app("shortcuts", "Keyboard shortcuts", <Keyboard {...I} />, () => n().showOverlay("shortcuts"), "?", "keys help"),
  ];
  return out;
}

function composeEntries(env: PaletteEnv): Entry[] {
  const c = env.composer;
  if (!c) return [];
  const out: Entry[] = [{ id: "template", label: "Insert template", group: "Composing", kind: "action", icon: <FileText {...I} />, page: "template", keywords: "snippet canned reply" }];
  if (env.fromOptions.length > 1) out.push({ id: "from", label: "Send from", group: "Composing", kind: "action", icon: <UserRound {...I} />, page: "from", keywords: "account alias sender address" });
  return out;
}

const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" } as const;
const LAYOUT_LABEL = { split: "Split", full: "Full screen" } as const;

function preferenceEntries(env: PaletteEnv): Entry[] {
  const { settings: s, update } = env;
  const toggle = (id: string, onLabel: string, offLabel: string, on: boolean, patch: DeepPartial<Settings>, message: string, keywords: string, icon: ReactNode): Entry => ({
    id, label: on ? offLabel : onLabel, group: "Preferences", kind: "toggle", icon, keywords, run: () => update(patch, message),
  });
  return [
    { id: "theme", label: "Theme", group: "Preferences", kind: "action", icon: <Moon {...I} />, page: "theme", hint: THEME_LABEL[s.appearance.theme], keywords: "dark light system appearance mode" },
    { id: "layout", label: "Layout", group: "Preferences", kind: "action", icon: <LayoutPanelLeft {...I} />, page: "layout", hint: LAYOUT_LABEL[s.appearance.layout], keywords: "split full screen panes single" },
    toggle("toggle:focused", "Turn on Focused inbox", "Turn off Focused inbox", s.inbox.focused, { inbox: { focused: !s.inbox.focused } }, `Focused inbox ${s.inbox.focused ? "off" : "on"}`, "smart people bundles", <Inbox {...I} />),
    toggle("toggle:photos", "Turn on sender photos", "Turn off sender photos", s.appearance.senderPhotos, { appearance: { senderPhotos: !s.appearance.senderPhotos } }, `Sender photos ${s.appearance.senderPhotos ? "off" : "on"}`, "avatars gravatar pictures", <UserRound {...I} />),
    toggle("toggle:appearance", "Show email in original colors", "Match email to theme", s.appearance.emailAppearance === "match", { appearance: { emailAppearance: s.appearance.emailAppearance === "match" ? "light" : "match" } },
      s.appearance.emailAppearance === "match" ? "Email shown in original colors" : "Email matches the theme", "dark mode html white", <Sun {...I} />),
    toggle("toggle:notifications", "Turn on notifications", "Turn off notifications", s.notifications.enabled, { notifications: { enabled: !s.notifications.enabled } }, `Notifications ${s.notifications.enabled ? "off" : "on"}`, "alerts mute", <Bell {...I} />),
  ];
}

function navigationEntries(env: PaletteEnv): Entry[] {
  const n = () => navStore.getState();
  const out: Entry[] = VIEWS.map((v) => ({ id: `go:${v.label}`, label: v.label, group: "Go to", kind: "go", icon: v.icon, shortcut: v.shortcut, keywords: v.keywords, run: () => n().go(v.target) }));
  if (env.accounts.length > 1) {
    env.accounts.forEach((a, i) =>
      out.push({ id: `acct:${a.id}`, label: `Inbox: ${a.email}`, group: "Go to", kind: "go", icon: <Inbox {...I} />, shortcut: i < 9 ? `mod+${i + 1}` : undefined, keywords: `${a.name} account`, run: () => n().go({ view: "inbox", accountId: a.id }, a.email) }),
    );
  }
  for (const c of CATEGORIES) {
    out.push({ id: `cat:${c}`, label: `Inbox: ${CATEGORY_TITLES[c]}`, group: "Categories", kind: "folder", icon: CATEGORY_ICON[c], quiet: true, keywords: "category bundle", run: () => n().openCategory(c) });
  }
  for (const a of env.sidebar?.accounts ?? []) {
    for (const f of moreFolders(a.folders)) {
      out.push({
        id: `folder:${f.id}`, label: f.name, detail: env.accounts.length > 1 ? a.account.email : undefined, group: "Folders", kind: "folder", icon: <Folder {...I} />, quiet: true, keywords: "label",
        run: () => n().go({ view: "folder", accountId: f.accountId, folderId: f.id }, f.name),
      });
    }
  }
  for (const s of SETTINGS_SECTIONS) {
    out.push({ id: `settings:${s.id}`, label: `Settings: ${s.label}`, group: "Settings", kind: "settings", icon: <SettingsIcon {...I} />, quiet: true, keywords: s.keywords, run: () => n().openSettings(s.id) });
  }
  for (const p of AI_SETTINGS_PAGES) {
    out.push({ id: `settings:ai/${p}`, label: `Settings: +AI, ${cap(p)}`, group: "Settings", kind: "settings", icon: <Sparkles {...I} />, quiet: true, keywords: "ai", run: () => n().openSettings(`ai/${p}`) });
  }
  return out;
}

/** Everything the palette can run from its first page. */
export function rootEntries(env: PaletteEnv): Entry[] {
  return [...(env.count > 0 ? actionEntries(env) : []), ...composeEntries(env), ...appEntries(env), ...navigationEntries(env), ...preferenceEntries(env)];
}

export function pageEntries(page: PageId, env: PaletteEnv): Entry[] {
  const opt = (id: string, label: string, run: () => void, extra: Partial<Entry> = {}): Entry => ({ id: `${page}:${id}`, label, group: PAGE_TITLES[page], kind: "option", run, ...extra });
  switch (page) {
    case "snooze":
      return [
        ...resolvePresets(env.now).map((p) => opt(p.id, p.label, () => env.run({ type: "snooze", until: p.at }), { icon: <Clock {...I} />, hint: formatPresetTime(p.at, env.now) })),
        opt("pick", "Pick date and time", () => env.cmds.snooze(), { icon: <CalendarClock {...I} />, keywords: "custom" }),
      ];
    case "move":
      return env.moveFolders.map((f) =>
        opt(String(f.id), f.name, () => env.run(f.role === "inbox" ? { type: "inbox" } : { type: "move", folderId: f.id, folderName: f.name }), {
          icon: f.role === "inbox" ? <Inbox {...I} /> : f.role === "archive" ? <Archive {...I} /> : f.role === "trash" ? <Trash2 {...I} /> : <Folder {...I} />,
        }),
      );
    case "category":
      return CATEGORIES.map((c) => opt(c, CATEGORY_TITLES[c], () => env.run({ type: "category", category: c }), { icon: CATEGORY_ICON[c], checked: env.category === c }));
    case "template":
      return env.templates.map((t) => opt(String(t.id), t.name, () => env.composer && sendComposerCommand({ composerId: env.composer.id, template: t }), { icon: <FileText {...I} />, detail: t.subject || undefined }));
    case "from":
      return env.fromOptions.map((o) => opt(o.address, o.address, () => env.composer && sendComposerCommand({ composerId: env.composer.id, from: o.address }), { icon: <UserRound {...I} />, hint: o.alias ? "alias" : undefined }));
    case "theme":
      return (["system", "light", "dark"] as const).map((t) =>
        opt(t, THEME_LABEL[t], () => env.update({ appearance: { theme: t } }, `Theme set to ${THEME_LABEL[t].toLowerCase()}`), { icon: t === "dark" ? <Moon {...I} /> : t === "light" ? <Sun {...I} /> : <Monitor {...I} />, checked: env.settings.appearance.theme === t }),
      );
    case "layout":
      return (["split", "full"] as const).map((l) =>
        opt(l, LAYOUT_LABEL[l], () => env.update({ appearance: { layout: l } }, `${LAYOUT_LABEL[l]} layout`), { icon: <LayoutPanelLeft {...I} />, checked: env.settings.appearance.layout === l }),
      );
  }
}
