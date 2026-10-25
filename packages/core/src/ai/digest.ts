import { FlintError } from "../types";
import { formatAddress, formatDate, formatToday, neutralizeTags } from "./context";
import { detectNeedsReply } from "./needsReply";
import type { AiContext, AiThreadBrief } from "./ports";
import { bundlePrompt, digestPrompt } from "./prompts";
import type { TaskPlan } from "./tasks";

// Plans for the inbox-management tasks: "Catch me up", bundle summaries and the
// local needs-reply list. Citations are index-aligned: [n] is always entry n.

const DIGEST_THREADS = 12;
const BUNDLE_THREADS = 15;
const NEEDS_REPLY_POOL = 40;
const DIGEST_TEXT_CHARS = 400;
const BUNDLE_TEXT_CHARS = 250;
const MAX_CONTEXT_CHARS = 14_000;
const DIGEST_TTL_MS = 30 * 60 * 1000;

const NOTHING_UNREAD = "Nothing unread from people. You're caught up.";
const NOTHING_IN_BUNDLE = "There's nothing in this bundle to summarize.";

function requireList(ctx: AiContext) {
  if (!ctx.listThreadsForAi) throw new FlintError("internal", "This build can't list mail for AI yet.");
  return ctx.listThreadsForAi.bind(ctx);
}

function mergedSelf(briefs: AiThreadBrief[]): { name: string; addresses: string[] } | undefined {
  const selves = briefs.map((b) => b.self).filter((s): s is NonNullable<AiThreadBrief["self"]> => s !== undefined);
  if (!selves.length) return undefined;
  return { name: selves[0]!.name, addresses: [...new Set(selves.flatMap((s) => s.addresses))] };
}

/** Numbered thread blocks within the character budget. Returns the text and how many threads made it in. */
export function numberedBriefs(briefs: AiThreadBrief[], textChars: number, timeZone?: string): { text: string; count: number } {
  const blocks: string[] = [];
  let used = 0;
  for (const [i, b] of briefs.entries()) {
    const body = b.lastText.replace(/\s+/g, " ").trim().slice(0, textChars) || "(no text)";
    const block = `[${i + 1}] From: ${formatAddress(b.from)}${b.lastFromMe ? " (you)" : ""} | Subject: ${b.subject || "(no subject)"} | Date: ${formatDate(b.date, timeZone)} | Messages: ${b.messageCount} | Unread: ${b.unreadCount}\n${body}`;
    if (blocks.length > 0 && used + block.length > MAX_CONTEXT_CHARS) break;
    blocks.push(block);
    used += block.length;
  }
  return { text: neutralizeTags(blocks.join("\n\n")), count: blocks.length };
}

function signature(briefs: AiThreadBrief[], count: number): string {
  return briefs.slice(0, count).map((b) => `${b.threadId}.${b.date}.${b.unreadCount}`).join(",");
}

function indexAligned(briefs: AiThreadBrief[], count: number) {
  return briefs.slice(0, count).map((b) => ({ threadId: b.threadId, subject: b.subject }));
}

export async function planDigest(ctx: AiContext): Promise<TaskPlan> {
  const briefs = await requireList(ctx)("unread_people", DIGEST_THREADS);
  if (briefs.length === 0) return immediate(NOTHING_UNREAD);
  const { text, count } = numberedBriefs(briefs, DIGEST_TEXT_CHARS, ctx.timeZone);
  return {
    system: digestPrompt(formatToday(ctx.now(), ctx.timeZone), mergedSelf(briefs)),
    messages: [{ role: "user", content: `<mail_excerpts>\n${text}\n</mail_excerpts>\n\nCatch me up on these ${count} unread threads.` }],
    effort: "low",
    streamText: true,
    cacheKey: `ai:digest:${signature(briefs, count)}`,
    cacheTtlMs: DIGEST_TTL_MS,
    citations: () => indexAligned(briefs, count),
  };
}

export async function planBundleSummary(category: "notifications" | "newsletters", ctx: AiContext): Promise<TaskPlan> {
  const briefs = await requireList(ctx)(category, BUNDLE_THREADS);
  if (briefs.length === 0) return immediate(NOTHING_IN_BUNDLE);
  const { text, count } = numberedBriefs(briefs, BUNDLE_TEXT_CHARS, ctx.timeZone);
  return {
    system: bundlePrompt(category, formatToday(ctx.now(), ctx.timeZone)),
    messages: [{ role: "user", content: `<mail_excerpts>\n${text}\n</mail_excerpts>\n\nSummarize these ${count} threads.` }],
    effort: "low",
    streamText: true,
    cacheKey: `ai:bundle:${category}:${signature(briefs, count)}`,
    cacheTtlMs: DIGEST_TTL_MS,
    citations: () => indexAligned(briefs, count),
  };
}

/** The needs-reply list as JSON text, from the local heuristic. */
export async function planNeedsReply(ctx: AiContext): Promise<TaskPlan> {
  const briefs = await requireList(ctx)("needs_reply_candidates", NEEDS_REPLY_POOL);
  return immediate(JSON.stringify(detectNeedsReply(briefs, ctx.now())));
}

function immediate(text: string): TaskPlan {
  return { system: "", messages: [], effort: "low", streamText: true, immediate: text };
}
