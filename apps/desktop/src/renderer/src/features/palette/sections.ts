import type { Contact, ThreadListItem } from "@flint/core";
import { createElement } from "react";
import { Mail, PenSquare, Search, Sparkles } from "lucide-react";
import { formatListTime, formatParticipants } from "../../lib/format";
import { navStore } from "../../state/nav";
import { openAsk } from "../ai/events";
import { openComposer } from "../compose/composerStore";
import { rank } from "./fuzzy";
import type { Mode } from "./modes";
import type { Entry, Row } from "./model";
import { recentIds, usageBoost, type Usage } from "./usage";

export type Status = { kind: "loading" | "error"; text: string };
export type Section = { id: string; title: string; meta?: string; rows: Row[]; status?: Status };
export type Remote = { threads: ThreadListItem[]; contacts: Contact[]; mailLoading: boolean; mailError: boolean };

export const NO_REMOTE: Remote = { threads: [], contacts: [], mailLoading: false, mailError: false };

const GROUP_ORDER = ["Actions", "Composing", "App", "Go to", "Preferences", "Categories", "Folders", "Settings"];
const RECENT_LIMIT = 5;
const MAIL_IN_ALL = 3;
const MAIL_IN_MODE = 8;
const PEOPLE_LIMIT = 4;
/** Where dynamic sections sit among command groups, on the same scale as match scores. */
const MAIL_RANK = 650;
const PEOPLE_RANK = 600;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const icon = { size: 15, strokeWidth: 1.5 } as const;

export type SectionInput = {
  mode: Mode;
  text: string;
  entries: Entry[];
  usage: Usage;
  now: number;
  remote: Remote;
  aiEnabled: boolean;
  /** Group title for thread actions, e.g. "3 threads". */
  actionMeta?: string;
};

const toRow = (e: Entry, ranges: Row["ranges"] = []): Row => ({ ...e, ranges });

function threadRow(t: ThreadListItem, now: number): Row {
  return toRow({
    id: `thread:${t.id}`, label: t.subject.trim() || "(no subject)", detail: formatParticipants(t.participants, 2), hint: formatListTime(t.lastDate, now), group: "Mail", kind: "mail",
    icon: createElement(Mail, icon), bold: t.unreadCount > 0, run: () => navStore.getState().openThread(t.id, { fromOutside: true }),
  });
}

function contactRows(text: string, contacts: Contact[]): Row[] {
  const rows = contacts.map((c) => {
    const name = c.name.trim();
    return toRow({
      id: `contact:${c.email}`, label: `Write to ${name || c.email}`, detail: name ? c.email : undefined, group: "People", kind: "contact", icon: createElement(PenSquare, icon),
      run: () => openComposer({ mode: "new", to: [{ name, address: c.email }] }),
    });
  });
  if (EMAIL.test(text) && !contacts.some((c) => c.email.toLowerCase() === text.toLowerCase())) {
    rows.unshift(toRow({ id: `contact:${text}`, label: `Write to ${text}`, group: "People", kind: "contact", icon: createElement(PenSquare, icon), run: () => openComposer({ mode: "new", to: [{ name: "", address: text }] }) }));
  }
  return rows;
}

function searchAllRow(text: string): Row {
  return toRow({
    id: "search-all", label: `Search all mail for “${text}”`, group: "Elsewhere", kind: "search", icon: createElement(Search, icon),
    run: () => { const n = navStore.getState(); n.openSearch(); n.setSearch(text); },
  });
}

const askRow = (text: string): Row => toRow({ id: "ask-ai", label: `Ask AI: ${text}`, group: "Elsewhere", kind: "ask", icon: createElement(Sparkles, icon), run: () => openAsk(text) });

function mailSection(input: SectionInput, limit: number): Section | null {
  const rows = input.remote.threads.slice(0, limit).map((t) => threadRow(t, input.now));
  return rows.length ? { id: "mail", title: "Mail", rows } : null;
}

/** The mail search status goes under the last section, so it appearing and clearing never moves rows above it. */
function mailStatus({ remote }: SectionInput): Status | undefined {
  if (remote.mailError) return { kind: "error", text: "Couldn't search mail. Check the connection and try again." };
  return remote.mailLoading ? { kind: "loading", text: "Searching mail" } : undefined;
}

function withStatus(sections: Section[], status: Status | undefined): Section[] {
  if (!status || sections.length === 0) return sections;
  return [...sections.slice(0, -1), { ...sections.at(-1)!, status }];
}

function rankedGroups(input: SectionInput, entries: Entry[]): { section: Section; score: number }[] {
  const groups = new Map<string, { rows: { row: Row; score: number }[]; top: number }>();
  for (const e of entries) {
    const m = rank(input.text, e.label, `${e.keywords ?? ""} ${e.detail ?? ""}`);
    if (!m) continue;
    const score = m.score + usageBoost(input.usage, e.id, input.now);
    const g = groups.get(e.group) ?? { rows: [], top: -Infinity };
    g.rows.push({ row: toRow(e, m.ranges), score });
    g.top = Math.max(g.top, score);
    groups.set(e.group, g);
  }
  return [...groups.entries()].map(([title, g]) => ({
    section: { id: title, title, meta: title === "Actions" ? input.actionMeta : undefined, rows: g.rows.sort((a, b) => b.score - a.score).map((r) => r.row) },
    score: g.top,
  }));
}

function byStaticOrder(entries: Entry[], actionMeta: string | undefined): Section[] {
  const groups = new Map<string, Row[]>();
  for (const e of entries) groups.set(e.group, [...(groups.get(e.group) ?? []), toRow(e)]);
  return [...groups.entries()]
    .sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]))
    .map(([title, rows]) => ({ id: title, title, meta: title === "Actions" ? actionMeta : undefined, rows }));
}

function recentSection(input: SectionInput): Section | null {
  const byId = new Map(input.entries.map((e) => [e.id, e]));
  const rows = recentIds(input.usage, 40).flatMap((id) => {
    const e = byId.get(id);
    return e ? [toRow({ ...e, hint: e.hint ?? (e.shortcut ? undefined : e.group), id: `recent:${e.id}` })] : [];
  }).slice(0, RECENT_LIMIT);
  return rows.length ? { id: "recent", title: "Recent", rows } : null;
}

/** The sections the palette shows for one query. Pure: remote results arrive through `input.remote`. */
export function buildSections(input: SectionInput): Section[] {
  const { mode, text, entries, remote } = input;
  const trimmed = text.trim();

  if (mode === "mail") {
    const sections: Section[] = [];
    const mail = trimmed ? mailSection(input, MAIL_IN_MODE) : null;
    if (mail) sections.push(mail);
    if (trimmed) sections.push({ id: "elsewhere", title: "Elsewhere", rows: [searchAllRow(trimmed)] });
    return withStatus(sections, mailStatus(input));
  }
  if (mode === "contacts") {
    const rows = contactRows(trimmed, remote.contacts);
    return rows.length ? [{ id: "people", title: "People", rows }] : [];
  }
  if (mode === "folders") {
    const pool = entries.filter((e) => e.kind === "folder");
    return trimmed ? rankedGroups(input, pool).sort((a, b) => b.score - a.score).map((g) => g.section) : byStaticOrder(pool, undefined);
  }
  if (mode === "commands") {
    const pool = entries.filter((e) => e.kind === "action" || e.kind === "toggle");
    return trimmed ? rankedGroups(input, pool).sort((a, b) => b.score - a.score).map((g) => g.section) : byStaticOrder(pool.filter((e) => !e.quiet), input.actionMeta);
  }

  if (!trimmed) {
    const recent = recentSection(input);
    return [...(recent ? [recent] : []), ...byStaticOrder(entries.filter((e) => !e.quiet), input.actionMeta)];
  }

  const ranked = rankedGroups(input, entries);
  const mail = mailSection(input, MAIL_IN_ALL);
  if (mail) ranked.push({ section: mail, score: MAIL_RANK });
  const people = contactRows(trimmed, remote.contacts).slice(0, PEOPLE_LIMIT);
  if (people.length) ranked.push({ section: { id: "people", title: "People", rows: people }, score: PEOPLE_RANK });
  const sections = ranked.sort((a, b) => b.score - a.score).map((g) => g.section);
  const elsewhere = [searchAllRow(trimmed), ...(input.aiEnabled && trimmed.length >= 3 ? [askRow(trimmed)] : [])];
  return withStatus([...sections, { id: "elsewhere", title: "Elsewhere", rows: elsewhere }], mailStatus(input));
}

/** Options on a nested page: filtered and ranked by the typed text, in their own order when nothing is typed. */
export function buildPageSections(entries: Entry[], text: string): Section[] {
  const trimmed = text.trim();
  const rows = trimmed
    ? entries.flatMap((e) => { const m = rank(trimmed, e.label, `${e.keywords ?? ""} ${e.detail ?? ""}`); return m ? [{ row: toRow(e, m.ranges), score: m.score }] : []; }).sort((a, b) => b.score - a.score).map((r) => r.row)
    : entries.map((e) => toRow(e));
  return rows.length ? [{ id: "page", title: "", rows }] : [];
}
