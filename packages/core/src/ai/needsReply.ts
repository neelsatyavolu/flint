import type { AiThreadBrief } from "./ports";

// "Needs reply": the newest message is from someone else, still unanswered, and
// asks a question or makes a request. A local heuristic; no model call.

export type NeedsReplyReason = "question" | "request";

const NO_REPLY_SENDER = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer-daemon|bounces?|alerts?|updates?|newsletter)([-_.+0-9].*)?$/i;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const WINDOW_CHARS = 700;

const REQUEST_PATTERNS: RegExp[] = [
  /\b(can|could|would|will) (you|u)\b/i,
  /\bplease (let me know|confirm|send|reply|respond|review|advise|share|check|sign|approve|forward|call|get back)\b/i,
  /\blet me know\b/i,
  /\b(need|needs|want|wanted) (you|your)\b/i,
  /\bwaiting (on|for) (you|your)\b/i,
  /\b(get|getting) back to (me|us)\b/i,
  /\brsvp\b/i,
  /\bby (eod|end of (the )?day|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday)\b/i,
  /\b(do|does) that work\b/i,
  /\bwhat do you think\b/i,
];

/** A question mark that ends a sentence, outside URLs and quoted lines. */
function hasQuestion(text: string): boolean {
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, " ");
  return withoutUrls.split("\n").some((line) => !/^\s*>/.test(line) && /\?(\s|$|["')\]])/.test(line));
}

/** Why this text wants an answer, or null when it does not. */
export function replyReason(text: string): NeedsReplyReason | null {
  const window = text.trim().slice(0, WINDOW_CHARS);
  if (!window) return null;
  if (hasQuestion(window)) return "question";
  return REQUEST_PATTERNS.some((re) => re.test(window)) ? "request" : null;
}

export type NeedsReplyItem = {
  threadId: number;
  subject: string;
  from: { name: string; address: string };
  date: number;
  unreadCount: number;
  reason: NeedsReplyReason;
};

/** Threads where someone else asked the user something and nobody has answered. Newest first. */
export function detectNeedsReply(briefs: AiThreadBrief[], now: number, max = 8): NeedsReplyItem[] {
  const out: NeedsReplyItem[] = [];
  for (const b of briefs) {
    if (b.lastFromMe || b.answered) continue;
    if (now - b.date > MAX_AGE_MS) continue;
    if (NO_REPLY_SENDER.test(b.from.address.split("@")[0] ?? "")) continue;
    const reason = replyReason(b.lastText);
    if (!reason) continue;
    out.push({ threadId: b.threadId, subject: b.subject, from: b.from, date: b.date, unreadCount: b.unreadCount, reason });
  }
  return out.sort((a, b) => b.date - a.date).slice(0, max);
}
