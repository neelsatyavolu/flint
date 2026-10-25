import { roleMember } from "../search";
import type { AiRankedQuery, AiThreadBrief, AiThreadListKind } from "../ai/ports";
import type { CategorizeCandidate } from "../ai/autoCategorize";
import { stripQuotedAndSignature } from "../ai/context";
import type { Address, Category, ThreadId } from "../types";
import { htmlToPlain } from "./fts";
import { parseJson, Sql } from "./sql";
import { recomputeThreads } from "./rollup";
import type { Store } from "./index";

// Queries that feed the AI features: OR-ranked retrieval for "ask your inbox",
// thread briefs for the digest, bundle summaries and needs-reply, and the
// plumbing behind AI categorization. Reads only, except applyCategoryVerdicts.

const NOBODY: Address = { name: "", address: "" };
const CANDIDATE_POOL = 300;
const HALF_LIFE_DAYS = 60;
const MAX_RECENCY_BOOST = 0.5;
const BRIEF_TEXT_CHARS = 900;

const sqlCache = new WeakMap<object, Sql>();
function sqlOf(store: Store): Sql {
  let q = sqlCache.get(store);
  if (!q) {
    q = new Sql(store.db);
    sqlCache.set(store, q);
  }
  return q;
}

const words = (text: string): string[] => text.match(/[\p{L}\p{N}]+/gu) ?? [];

/** FTS5 MATCH string: every word a prefix (so plurals and verb forms match), every phrase exact, all OR-ed. */
export function buildRankedMatch(terms: string[], phrases: string[]): string | null {
  const parts: string[] = [];
  for (const t of terms) {
    const w = words(t);
    if (w.length) parts.push(`"${w.join(" ")}" *`);
  }
  for (const p of phrases) {
    const w = words(p);
    if (w.length) parts.push(`"${w.join(" ")}"`);
  }
  return parts.length ? parts.join(" OR ") : null;
}

type HitRow = { id: number; thread_id: number; date: number; score: number };

/**
 * Threads matching any term, best first. Messages are scored with bm25 (subject counts most),
 * a thread takes its best message, and newer threads get a boost that halves every 60 days.
 */
export function rankedThreadSearch(store: Store, query: AiRankedQuery, now: number = Date.now()) {
  const q = sqlOf(store);
  const match = buildRankedMatch(query.terms, query.phrases);
  const filters: string[] = [
    "m.draft = 0",
    `NOT ${roleMember("trash")}`,
    `NOT ${roleMember("spam")}`,
  ];
  const params: (string | number)[] = [];
  if (query.after !== undefined) { filters.push("m.date >= ?"); params.push(query.after); }
  if (query.before !== undefined) { filters.push("m.date < ?"); params.push(query.before); }
  const senders = query.from.map((f) => f.trim().toLowerCase()).filter(Boolean);
  if (senders.length) {
    filters.push(`(${senders.map(() => "lower(m.from_json) LIKE ? ESCAPE '\\'").join(" OR ")})`);
    for (const s of senders) params.push(`%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  let rows: HitRow[];
  if (match) {
    rows = q.all<HitRow>(
      `SELECT m.id AS id, m.thread_id AS thread_id, m.date AS date, bm25(messages_fts, 6.0, 2.0, 1.0, 1.0) AS score
       FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
       WHERE messages_fts MATCH ? AND ${filters.join(" AND ")}
       ORDER BY score LIMIT ${CANDIDATE_POOL}`,
      match, ...params,
    );
  } else if (senders.length || query.after !== undefined || query.before !== undefined) {
    rows = q.all<HitRow>(
      `SELECT m.id AS id, m.thread_id AS thread_id, m.date AS date, -1.0 AS score
       FROM messages m WHERE ${filters.join(" AND ")} ORDER BY m.date DESC LIMIT ${CANDIDATE_POOL}`,
      ...params,
    );
  } else {
    return [];
  }

  const best = new Map<number, { score: number; date: number }>();
  for (const r of rows) {
    const rank = -r.score * (1 + MAX_RECENCY_BOOST * Math.pow(0.5, Math.max(0, now - r.date) / (HALF_LIFE_DAYS * 86_400_000)));
    const cur = best.get(r.thread_id);
    if (!cur || rank > cur.score) best.set(r.thread_id, { score: rank, date: r.date });
  }
  const ordered = [...best.entries()].sort((a, b) => b[1].score - a[1].score || b[1].date - a[1].date).slice(0, query.limit).map(([id]) => id);
  return store.itemsForThreads(ordered).map((t) => ({
    threadId: t.id, subject: t.subject, date: t.lastDate, from: t.participants.at(-1) ?? NOBODY, snippet: t.snippet,
  }));
}

type LastRow = {
  id: number; from_json: string; date: number; seen: number; answered: number; subject: string;
  text: string | null; html: string | null; snippet: string; account_id: string;
};

function briefOf(store: Store, q: Sql, own: Set<string>, item: { id: number; subject: string; unreadCount: number; messageCount: number }): AiThreadBrief | null {
  const last = q.get<LastRow>(
    `SELECT id, from_json, date, seen, answered, subject, snippet, account_id,
            substr(text_body, 1, 6000) AS text, CASE WHEN text_body IS NULL OR text_body = '' THEN substr(html_body, 1, 20000) END AS html
     FROM messages WHERE thread_id = ? AND draft = 0 ORDER BY date DESC, id DESC LIMIT 1`,
    item.id,
  );
  if (!last) return null;
  const from = parseJson<Address[]>(last.from_json, [])[0] ?? NOBODY;
  const raw = last.text && last.text.trim() ? last.text : last.html ? htmlToPlain(last.html) : last.snippet;
  const account = store.getAccount(last.account_id);
  return {
    threadId: item.id, subject: item.subject, date: last.date, from,
    lastText: stripQuotedAndSignature(raw).slice(0, BRIEF_TEXT_CHARS),
    unreadCount: item.unreadCount, messageCount: item.messageCount,
    lastFromMe: own.has(from.address.toLowerCase()), answered: last.answered === 1,
    ...(account ? { self: { name: account.name, addresses: [...new Set([account.email, ...account.aliases])] } } : {}),
  };
}

/** Threads for the digest, bundle summaries and needs-reply detection, newest first. */
export function aiThreadBriefs(store: Store, kind: AiThreadListKind, limit: number, now: number = Date.now()): AiThreadBrief[] {
  const q = sqlOf(store);
  const items = (() => {
    switch (kind) {
      case "unread_people": return store.listThreads({ view: "inbox", focused: true, unreadOnly: true, limit }, now).items;
      case "needs_reply_candidates": return store.listThreads({ view: "inbox", focused: true, limit }, now).items;
      case "notifications":
      case "newsletters": {
        const unread = store.listThreads({ view: "inbox", category: kind, unreadOnly: true, limit }, now).items;
        return unread.length ? unread : store.listThreads({ view: "inbox", category: kind, limit }, now).items;
      }
    }
  })();
  const own = store.ownAddresses();
  return items.map((i) => briefOf(store, q, own, i)).filter((b): b is AiThreadBrief => b !== null);
}

// ---------- AI categorization ----------

const CANDIDATE_WINDOW_MS = 3 * 86_400_000;

type CandidateRow = {
  id: number; thread_id: number; from_json: string; subject: string; date: number; snippet: string;
  text: string | null; html: string | null; headers_json: string; in_reply_to: string | null; has_html: number;
};

/** Recent inbox mail from people the user has never written to, still filed as people. Newest first. */
export function categorizeCandidates(store: Store, now: number, limit: number): CategorizeCandidate[] {
  const q = sqlOf(store);
  const own = store.ownAddresses();
  const rows = q.all<CandidateRow>(
    `SELECT m.id, m.thread_id, m.from_json, m.subject, m.date, m.snippet, m.in_reply_to,
            substr(m.text_body, 1, 3000) AS text,
            CASE WHEN m.text_body IS NULL OR m.text_body = '' THEN substr(m.html_body, 1, 20000) END AS html,
            (m.html_body IS NOT NULL AND m.html_body <> '') AS has_html, m.headers_json
     FROM messages m
     WHERE m.draft = 0 AND m.category = 'people' AND m.date >= ? AND ${roleMember("inbox")}
     ORDER BY m.date DESC LIMIT ${limit * 8}`,
    now - CANDIDATE_WINDOW_MS,
  );
  const out: CategorizeCandidate[] = [];
  for (const r of rows) {
    const from = parseJson<Address[]>(r.from_json, [])[0];
    if (!from || own.has(from.address.toLowerCase()) || store.hasSentTo(from.address)) continue;
    const text = r.text && r.text.trim() ? r.text : r.html ? htmlToPlain(r.html) : r.snippet;
    out.push({
      messageId: r.id, threadId: r.thread_id, from, subject: r.subject, text: text.slice(0, 3000),
      headers: parseJson<Record<string, string>>(r.headers_json, {}), isReply: Boolean(r.in_reply_to), html: r.has_html === 1, date: r.date,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Stores the model's verdicts as category overrides on the messages, then refreshes the threads.
 * Returns the thread ids whose category changed, for a mail_changed event.
 */
export function applyCategoryVerdicts(store: Store, verdicts: { messageId: number; category: Category }[]): ThreadId[] {
  const q = sqlOf(store);
  const changed = new Set<ThreadId>();
  store.transaction(() => {
    for (const v of verdicts) {
      const row = q.get<{ thread_id: number; category: string | null }>("SELECT thread_id, category FROM messages WHERE id = ?", v.messageId);
      if (!row || row.category === v.category) continue;
      q.run("UPDATE messages SET category = ? WHERE id = ?", v.category, v.messageId);
      changed.add(row.thread_id);
    }
    recomputeThreads(q, changed);
  });
  return [...changed];
}
