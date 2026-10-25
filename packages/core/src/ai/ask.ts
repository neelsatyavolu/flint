import type { Address, ThreadId } from "../types";
import { buildThreadContext, formatAddress, formatDate, neutralizeTags } from "./context";
import type { AiContext } from "./ports";

// Retrieval for "ask your inbox": keyword extraction (no model call), local
// search, and a compact numbered context.

const MAX_THREADS = 20;
const FULL_THREADS = 6;
const FULL_THREAD_CHARS = 3000;
const MAX_ASK_CONTEXT_CHARS = 30_000;
const MAX_QUERIES = 6;

const STOPWORDS = new Set((
  "a about after again all also am an and any are as at be been before being but by can could did do does doing for from get got had has have " +
  "he her here him his how i if in into is it its just me more most my of on or other our out over said she should so some than that the their them then " +
  "there these they this those to up us was we were what when where which who whom why will with would you your yours " +
  "came come comes coming email emails mail mails message messages thread threads find show tell give list please say says said anything something last recent latest ago week month year today yesterday " +
  "did what whats which sent send received receive got any know remind one ones earlier previous another same"
).split(/\s+/));

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAY_MS = 86_400_000;
const DATE_FILTER_RE = /\b(?:after|before):\d{4}-\d{2}-\d{2}\b/g;

export function stripDateFilters(query: string): string {
  return query.replace(DATE_FILTER_RE, " ").replace(/\s+/g, " ").trim();
}

function localDay(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { ...(timeZone ? { timeZone } : {}), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Maps today/yesterday/last week/last month/in March to after:/before: filters. */
export function dateFilters(question: string, now: number, timeZone?: string): string[] {
  const q = question.toLowerCase();
  const day = (offset: number) => localDay(now + offset * DAY_MS, timeZone);
  if (/\btoday\b/.test(q)) return [`after:${day(0)}`];
  if (/\byesterday\b/.test(q)) return [`after:${day(-1)}`, `before:${day(0)}`];
  if (/\b(last|past|this) week\b/.test(q)) return [`after:${day(-7)}`];
  if (/\b(last|past|this) month\b/.test(q)) return [`after:${day(-31)}`];
  const named = MONTHS.findIndex((m) =>
    m === "may" ? /\b(?:in|during|of|since) may\b|\bmay \d/.test(q) : new RegExp(`\\b${m}\\b`).test(q));
  if (named >= 0) {
    const [y, m] = day(0).split("-").map(Number) as [number, number];
    const year = named + 1 > m ? y - 1 : y;
    const next = named === 11 ? `${year + 1}-01-01` : `${year}-${String(named + 2).padStart(2, "0")}-01`;
    return [`after:${year}-${String(named + 1).padStart(2, "0")}-01`, `before:${next}`];
  }
  return [];
}

/** Light stemming: invoices -> invoice, meetings -> meeting, parties -> party. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && w.endsWith("es") && /(?:ch|sh|x|ss|zz)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

/**
 * Turns a question into several search queries. Keywords are searched separately
 * (and as a short AND of the most distinctive ones) so one unlucky word does not
 * empty the result; retrieve() ranks threads found by more queries first.
 */
export function extractQueries(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = [],
  now: number = Date.now(),
  timeZone?: string,
): string[] {
  const attempt = (text: string): string[] => {
    const emails = text.match(EMAIL_RE) ?? [];
    const quoted = [...text.matchAll(/"([^"]{3,80})"/g)].map((m) => m[1]!.trim());
    const rest = text.replace(EMAIL_RE, " ").replace(/"[^"]*"/g, " ");
    const words = (rest.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [])
      .map((w) => w.replace(/'s$/, "").replace(/^'+|'+$/g, ""))
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    const unique = [...new Set(words.map(stem))];
    const dates = dateFilters(text, now, timeZone).join(" ");
    const withDate = (q: string) => (dates ? `${q} ${dates}` : q);
    const byDistinctiveness = [...unique].sort((a, b) => b.length - a.length);
    const queries: string[] = [];
    if (unique.length) queries.push(withDate(byDistinctiveness.slice(0, 3).join(" ")));
    for (const q of quoted) queries.push(withDate(`"${q}"`));
    for (const e of emails) queries.push(withDate(`from:${e}`));
    if (unique.length > 1) for (const w of byDistinctiveness.slice(0, 4)) queries.push(withDate(w));
    if (!queries.length && dates) queries.push(dates);
    return [...new Set(queries)].slice(0, MAX_QUERIES);
  };
  const direct = attempt(question);
  if (direct.length && direct.some((q) => stripDateFilters(q))) return direct;
  // A follow-up such as "and the one before?" borrows keywords from the last user turn.
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn?.role !== "user") continue;
    const fallback = attempt(turn.content);
    if (fallback.some((q) => stripDateFilters(q))) {
      const dates = dateFilters(question, now, timeZone).join(" ");
      return dates ? fallback.map((q) => `${stripDateFilters(q)} ${dates}`) : fallback;
    }
  }
  return direct;
}

export type Hit = { threadId: ThreadId; subject: string; date: number; from: Address; snippet: string };

/** Runs the queries, ranks threads found by several queries first, caps at 20. */
export async function retrieve(ctx: AiContext, queries: string[]): Promise<Hit[]> {
  const results = await Promise.all(queries.map((q) => ctx.searchForAi(q, MAX_THREADS).catch(() => [] as Hit[])));
  const byThread = new Map<ThreadId, { hit: Hit; score: number; order: number }>();
  let order = 0;
  for (const list of results) {
    for (const hit of list) {
      const existing = byThread.get(hit.threadId);
      if (existing) existing.score += 1;
      else byThread.set(hit.threadId, { hit, score: 1, order: order++ });
    }
  }
  return [...byThread.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, MAX_THREADS)
    .map((e) => e.hit);
}

/** Numbered excerpts: the first few threads with message text, the rest with snippets. */
export async function buildAskContext(ctx: AiContext, hits: Hit[]): Promise<string> {
  const details = await Promise.all(
    hits.map((h, i) => (i < FULL_THREADS ? ctx.getThreadForAi(h.threadId).catch(() => null) : Promise.resolve(null))),
  );
  const parts = hits.map((h, i) => {
    const head = `[${i + 1}] Subject: ${h.subject || "(no subject)"} | Latest: ${formatDate(h.date, ctx.timeZone)} | From: ${formatAddress(h.from)}`;
    const detail = details[i];
    const body = detail
      ? buildThreadContext(detail.messages, FULL_THREAD_CHARS, ctx.timeZone).text
      : h.snippet;
    return `${head}\n${body}`;
  });
  let out = "";
  for (const p of parts) {
    if (out.length + p.length > MAX_ASK_CONTEXT_CHARS && out) break;
    out += (out ? "\n\n" : "") + p.slice(0, MAX_ASK_CONTEXT_CHARS);
  }
  return neutralizeTags(out);
}

/** Threads whose [n] marker appears in the answer, in order of first citation. */
export function citedThreads(text: string, hits: Hit[]): { threadId: ThreadId; subject: string }[] {
  const seen = new Set<number>();
  const out: { threadId: ThreadId; subject: string }[] = [];
  for (const m of text.matchAll(/\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g)) {
    for (const part of m[1]!.split(/[,;]/)) {
      const n = Number(part.trim());
      const hit = hits[n - 1];
      if (hit && !seen.has(n)) {
        seen.add(n);
        out.push({ threadId: hit.threadId, subject: hit.subject });
      }
    }
  }
  return out;
}
