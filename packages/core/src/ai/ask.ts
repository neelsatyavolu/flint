import type { Address, ThreadId } from "../types";
import { buildThreadContext, formatAddress, formatDate, neutralizeTags } from "./context";
import type { AiContext } from "./ports";

// Retrieval for "ask your inbox": keyword extraction (no model call), local
// search, and a compact numbered context.

const MAX_THREADS = 20;
const FULL_THREADS = 6;
const FULL_THREAD_CHARS = 3000;
const MAX_ASK_CONTEXT_CHARS = 30_000;
const MAX_QUERIES = 3;

const STOPWORDS = new Set((
  "a about after again all also am an and any are as at be been before being but by can could did do does doing for from get got had has have " +
  "he her here him his how i if in into is it its just me more most my of on or other our out over said she should so some than that the their them then " +
  "there these they this those to up us was we were what when where which who whom why will with would you your yours " +
  "email emails mail mails message messages thread threads find show tell give list please anything something last recent latest ago week month year today yesterday " +
  "did what whats which sent send received receive got any know remind one ones earlier previous another same"
).split(/\s+/));

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/** Turns a question into 1 to 3 search queries. */
export function extractQueries(question: string, history: { role: "user" | "assistant"; content: string }[] = []): string[] {
  const attempt = (text: string): string[] => {
    const emails = text.match(EMAIL_RE) ?? [];
    const quoted = [...text.matchAll(/"([^"]{3,80})"/g)].map((m) => m[1]!.trim());
    const rest = text.replace(EMAIL_RE, " ").replace(/"[^"]*"/g, " ");
    const words = (rest.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [])
      .map((w) => w.replace(/'s$/, "").replace(/^'+|'+$/g, ""))
      .filter((w) => w.length > 2 && !STOPWORDS.has(w));
    const unique = [...new Set(words)];
    const queries: string[] = [];
    if (unique.length) queries.push(unique.slice(0, 6).join(" "));
    for (const q of quoted) queries.push(`"${q}"`);
    for (const e of emails) queries.push(`from:${e}`);
    const longest = [...unique].sort((a, b) => b.length - a.length)[0];
    if (longest && unique.length > 1) queries.push(longest);
    return [...new Set(queries)].slice(0, MAX_QUERIES);
  };
  const direct = attempt(question);
  if (direct.length) return direct;
  // A follow-up such as "and the one before?" borrows keywords from the last user turn.
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    if (turn?.role !== "user") continue;
    const fallback = attempt(turn.content);
    if (fallback.length) return fallback;
  }
  return [];
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
    const head = `[${i + 1}] Subject: ${h.subject || "(no subject)"} | Latest: ${formatDate(h.date)} | From: ${formatAddress(h.from)}`;
    const detail = details[i];
    const body = detail
      ? buildThreadContext(detail.messages, FULL_THREAD_CHARS).text
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
