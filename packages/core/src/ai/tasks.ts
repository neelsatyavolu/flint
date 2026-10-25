import { z } from "zod";
import { FlintError, type AiTask } from "../types";
import { askCitationsFor, planAsk } from "./ask-plan";
import { buildThreadContext, neutralizeTags } from "./context";
import { planBundleSummary, planDigest, planNeedsReply } from "./digest";
import type { AiContext } from "./ports";
import {
  composePrompt, quickRepliesPrompt, replyPrompt, rewritePrompt, summarizePrompt, translatePrompt, type Voice,
} from "./prompts";
import type { ChatMessage, Effort } from "./stream";

export const SUMMARY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const QUICK_REPLIES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const BULK_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer-daemon|bounces?|alerts?|newsletter|news|digest|updates?|marketing)([-_.+0-9].*)?$/i;
const BULK_TEXT = /\b(unsubscribe|view (this email )?in (your )?browser|manage (your )?(email )?preferences)\b/i;

/** Quick replies only make sense for a real person who wrote last. */
export function quickRepliesSkipReason(newest: { from: { address: string }; fromMe?: boolean; text: string }): string | null {
  if (newest.fromMe) return "the user wrote last";
  if (BULK_SENDER.test(newest.from.address.split("@")[0] ?? "")) return "automated sender";
  if (BULK_TEXT.test(newest.text.slice(0, 20_000))) return "bulk mail";
  return null;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Thrown by finalize when the output is unusable; the engine asks the model once more with `feedback`. */
export class OutputRejected extends Error {
  constructor(readonly feedback: string) {
    super(feedback);
  }
}

export type TaskPlan = {
  system: string;
  messages: ChatMessage[];
  effort: Effort;
  /** Stream deltas to the caller as they arrive. Off when the output is validated first. */
  streamText: boolean;
  cacheKey?: string;
  cacheTtlMs?: number;
  /** Answer without calling the model. */
  immediate?: string;
  finalize?: (text: string) => string;
  citations?: (text: string) => { threadId: number; subject: string }[];
};

const text = (max: number) => z.string().trim().min(1).max(max);
const turn = z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(8000) });
const threadId = z.number().int().positive();

export const aiTaskSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summarize"), threadId }),
  z.object({ kind: z.literal("reply"), threadId, instructions: z.string().max(4000).optional() }),
  z.object({ kind: z.literal("quickReplies"), threadId }),
  z.object({ kind: z.literal("compose"), prompt: text(8000), draftId: z.number().int().positive().optional() }),
  z.object({ kind: z.literal("rewrite"), text: text(50_000), style: text(300) }),
  z.object({
    kind: z.literal("translate"),
    text: text(50_000).optional(),
    threadId: threadId.optional(),
    language: text(64),
  }).refine((t) => Boolean(t.text) !== Boolean(t.threadId), "Give either text or a thread to translate."),
  z.object({ kind: z.literal("ask"), question: text(2000), history: z.array(turn).max(20).optional() }),
  z.object({ kind: z.literal("digest") }),
  z.object({ kind: z.literal("summarizeBundle"), category: z.enum(["notifications", "newsletters"]) }),
  z.object({ kind: z.literal("needsReply") }),
]);

export function parseTask(input: unknown): AiTask {
  const parsed = aiTaskSchema.safeParse(input);
  if (!parsed.success) {
    throw new FlintError("invalid", parsed.error.issues[0]?.message ?? "That AI request is not valid.");
  }
  return parsed.data as AiTask;
}

function voiceOf(ctx: AiContext): Voice {
  const ai = ctx.getSettings().ai;
  return { writingStyle: ai.writingStyle ?? "", replyLanguage: ai.replyLanguage ?? "" };
}

async function loadThread(ctx: AiContext, id: number) {
  const thread = await ctx.getThreadForAi(id);
  if (!thread || thread.messages.length === 0) throw new FlintError("not_found", "That conversation is no longer available.");
  return thread;
}

function threadMaterial(subject: string, body: string): string {
  return `<email_thread>\nSubject: ${neutralizeTags(subject)}\n\n${body}\n</email_thread>`;
}

const word = (s: string) => s.trim().split(/\s+/).filter(Boolean);

const repliesSchema = z.array(z.string().trim().min(1).max(200)).length(3)
  .refine((list) => list.every((r) => word(r).length <= 12), "Each reply must be at most 12 words.");

/** Pulls the first JSON array out of model output that may carry fences or chatter. */
export function parseQuickReplies(raw: string): string[] {
  const unfenced = raw.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("[");
  const end = unfenced.lastIndexOf("]");
  let value: unknown;
  try {
    value = JSON.parse(start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced);
  } catch {
    throw new OutputRejected("That was not valid JSON. Respond with only a JSON array of exactly 3 strings, each at most 12 words.");
  }
  if (!Array.isArray(value) && typeof value === "object" && value !== null) {
    const inner = Object.values(value).find(Array.isArray);
    if (inner) value = inner;
  }
  const checked = repliesSchema.safeParse(value);
  if (!checked.success) {
    throw new OutputRejected("Respond with only a JSON array of exactly 3 strings, each at most 12 words.");
  }
  return checked.data;
}

export async function planTask(task: AiTask, ctx: AiContext): Promise<TaskPlan> {
  const voice = voiceOf(ctx);
  switch (task.kind) {
    case "summarize": {
      const thread = await loadThread(ctx, task.threadId);
      const latest = Math.max(...thread.messages.map((m) => m.date));
      const { text: body } = buildThreadContext(thread.messages, undefined, ctx.timeZone);
      return {
        system: summarizePrompt(thread.self),
        messages: [{ role: "user", content: `${threadMaterial(thread.subject, body)}\n\nSummarize this thread.` }],
        effort: "low",
        streamText: true,
        cacheKey: `ai:summary:${task.threadId}:${latest}`,
        cacheTtlMs: SUMMARY_TTL_MS,
      };
    }
    case "reply": {
      const thread = await loadThread(ctx, task.threadId);
      const { text: body } = buildThreadContext(thread.messages, undefined, ctx.timeZone);
      const extra = task.instructions?.trim()
        ? `The user's instructions for this reply: ${task.instructions.trim()}`
        : "No special instructions. Write the most useful reply.";
      return {
        system: replyPrompt(voice, thread.self),
        messages: [{ role: "user", content: `${threadMaterial(thread.subject, body)}\n\n${extra}\n\nWrite the reply.` }],
        effort: "medium",
        streamText: true,
      };
    }
    case "quickReplies": {
      const thread = await loadThread(ctx, task.threadId);
      const newest = thread.messages.at(-1);
      if (!newest || quickRepliesSkipReason(newest)) {
        return { system: "", messages: [], effort: "low", streamText: false, immediate: "[]" };
      }
      const latest = Math.max(...thread.messages.map((m) => m.date));
      const { text: body } = buildThreadContext(thread.messages, 16_000, ctx.timeZone);
      return {
        system: quickRepliesPrompt(voice, thread.self),
        messages: [{ role: "user", content: `${threadMaterial(thread.subject, body)}\n\nGive the 3 quick replies.` }],
        effort: "low",
        streamText: false,
        finalize: (raw) => JSON.stringify(parseQuickReplies(raw)),
        cacheKey: `ai:qr:${task.threadId}:${thread.messages.length}:${latest}:${hash(`${voice.writingStyle}|${voice.replyLanguage}`)}`,
        cacheTtlMs: QUICK_REPLIES_TTL_MS,
      };
    }
    case "compose": {
      const draft = task.draftId && ctx.getDraft ? await ctx.getDraft(task.draftId) : null;
      const hasDraft = Boolean(draft && draft.text.trim());
      const draftBlock = hasDraft && draft
        ? `<draft>\nSubject: ${neutralizeTags(draft.subject)}\n\n${neutralizeTags(draft.text.slice(0, 12_000))}\n</draft>\n\n`
        : "";
      return {
        system: composePrompt(voice, hasDraft),
        messages: [{ role: "user", content: `${draftBlock}Instructions: ${task.prompt}` }],
        effort: "medium",
        streamText: true,
      };
    }
    case "rewrite":
      return {
        system: rewritePrompt(task.style),
        messages: [{ role: "user", content: `<text>\n${neutralizeTags(task.text)}\n</text>` }],
        effort: "low",
        streamText: true,
      };
    case "translate": {
      if (task.threadId) {
        const thread = await loadThread(ctx, task.threadId);
        const { text: body } = buildThreadContext(thread.messages, undefined, ctx.timeZone);
        const latest = Math.max(...thread.messages.map((m) => m.date));
        return {
          system: translatePrompt(task.language, true),
          messages: [{ role: "user", content: `${threadMaterial(thread.subject, body)}\n\nTranslate into ${task.language}.` }],
          effort: "low",
          streamText: true,
          cacheKey: `ai:translate:${task.threadId}:${latest}:${hash(task.language)}`,
          cacheTtlMs: SUMMARY_TTL_MS,
        };
      }
      return {
        system: translatePrompt(task.language, false),
        messages: [{ role: "user", content: `<text>\n${neutralizeTags(task.text ?? "")}\n</text>` }],
        effort: "low",
        streamText: true,
      };
    }
    case "ask": {
      const asked = await planAsk(task, ctx);
      return {
        ...asked.plan,
        citations: (out) => askCitationsFor(out, asked.hits),
      };
    }
    case "digest":
      return planDigest(ctx);
    case "summarizeBundle":
      return planBundleSummary(task.category, ctx);
    case "needsReply":
      return planNeedsReply(ctx);
  }
}
