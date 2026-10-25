import type { SearchObject } from "imapflow";
import type { ParsedSearch, SearchFilter } from "./types";

/** Folder names in `in:` that mean a mailbox role rather than a user folder. */
const ROLE_NAMES = new Set(["inbox", "sent", "drafts", "trash", "spam", "archive"]);

/** Local midnight epoch ms as YYYY/MM/DD, the date form Gmail search takes. */
function gmailDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

const clean = (s: string): string => s.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
const word = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);

function gmailFilter(key: string, f: SearchFilter): string | null {
  const v = clean(f.value);
  if (!v) return null;
  return `${f.negated ? "-" : ""}${key}:${word(v)}`;
}

function gmailIn(f: SearchFilter): string | null {
  const v = clean(f.value);
  if (!v) return null;
  const neg = f.negated ? "-" : "";
  if (v === "archive") return f.negated ? "in:inbox" : "-in:inbox -in:sent -in:drafts";
  if (ROLE_NAMES.has(v)) return `${neg}in:${v}`;
  return `${neg}label:${word(v.replace(/\s+/g, "-"))}`;
}

/**
 * The query Gmail's X-GM-RAW understands for a parsed Flint search, or null when there is nothing to ask the server.
 * The result is a superset-friendly translation: the local database applies Flint's exact rules afterwards.
 */
export function buildGmailRaw(p: ParsedSearch): string | null {
  const parts: string[] = [];
  for (const t of p.terms) {
    const text = clean(t.text);
    if (!text) continue;
    parts.push(`${t.negated ? "-" : ""}${t.phrase ? `"${text}"` : text}`);
  }
  for (const [key, list] of [["from", p.from], ["to", p.to], ["cc", p.cc], ["subject", p.subject]] as const) {
    for (const f of list) {
      const part = gmailFilter(key, f);
      if (part) parts.push(part);
    }
  }
  for (const f of p.in) {
    const part = gmailIn(f);
    if (part) parts.push(part);
  }
  if (p.hasAttachment !== null) parts.push(p.hasAttachment ? "has:attachment" : "-has:attachment");
  if (p.unread !== null) parts.push(p.unread ? "is:unread" : "is:read");
  if (p.pinned === true) parts.push("is:starred");
  if (p.after !== null) parts.push(`after:${gmailDay(p.after)}`);
  if (p.before !== null) parts.push(`before:${gmailDay(p.before)}`);
  return parts.length ? parts.join(" ") : null;
}

const firstPositive = (list: SearchFilter[]): string | null => list.find((f) => !f.negated && clean(f.value))?.value.trim() ?? null;

/**
 * IMAP SEARCH criteria for a parsed Flint search on a server without Gmail extensions, or null when nothing in the
 * query can be asked of the server. IMAP criteria cannot repeat a key, so the most selective positive value of each
 * kind is sent; the local database applies the full query to what comes back.
 */
export function buildImapCriteria(p: ParsedSearch): SearchObject | null {
  const out: SearchObject = {};
  const from = firstPositive(p.from);
  const to = firstPositive(p.to);
  const cc = firstPositive(p.cc);
  const subject = firstPositive(p.subject);
  if (from) out.from = from;
  if (to) out.to = to;
  if (cc) out.cc = cc;
  if (subject) out.subject = subject;
  const text = p.terms.filter((t) => !t.negated && clean(t.text)).map((t) => t.text.trim()).sort((a, b) => b.length - a.length)[0];
  if (text) out.text = text;
  if (p.unread !== null) out.seen = !p.unread;
  if (p.pinned === true) out.flagged = true;
  if (p.after !== null) out.since = new Date(p.after);
  if (p.before !== null) out.before = new Date(p.before);
  return Object.keys(out).length ? out : null;
}

/** Folder hints from `in:` operators: mailbox roles and user folder names the query is limited to. */
export function inTargets(p: ParsedSearch): { roles: string[]; names: string[] } {
  const wanted = p.in.filter((f) => !f.negated).map((f) => f.value.toLowerCase());
  return { roles: wanted.filter((v) => ROLE_NAMES.has(v)), names: wanted.filter((v) => !ROLE_NAMES.has(v)) };
}
