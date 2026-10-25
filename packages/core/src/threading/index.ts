import type { Address } from "../types";

/** Subject without reply/forward markers and [list] tags, lowercased and collapsed. */
export function normalizeSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s
      .replace(/^(re|fwd?|aw|sv|wg|vs|antw|tr|rv|r)\s*(\[\d+\])?\s*:\s*/i, "")
      .replace(/^\[[^\]]{1,40}\]\s*/, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Strips angle brackets and whitespace from a Message-ID style token. */
export function cleanMessageId(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().replace(/^<+|>+$/g, "").trim();
  return v ? v : null;
}

export type ThreadingInput = {
  gmThrid?: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
};

/** SPEC section 4: Gmail uses X-GM-THRID, otherwise the first reference, else In-Reply-To, else the message's own id. */
export function threadKeyFor(i: ThreadingInput): string | null {
  if (i.gmThrid) return `gm:${i.gmThrid}`;
  const root = cleanMessageId(i.references[0]) ?? cleanMessageId(i.inReplyTo) ?? cleanMessageId(i.messageId);
  return root ? `mid:${root}` : null;
}

/** True when the message points at another message, so subject matching must not apply. */
export function hasParentLink(i: ThreadingInput): boolean {
  return cleanMessageId(i.references[0]) !== null || cleanMessageId(i.inReplyTo) !== null;
}

/** Every Message-ID this message links to (references, then In-Reply-To), cleaned and unique. */
export function linkedIds(i: ThreadingInput): string[] {
  const all = [...i.references, i.inReplyTo ?? ""].map(cleanMessageId).filter((v): v is string => v !== null);
  return [...new Set(all)];
}

export function participantSet(...lists: Address[][]): Set<string> {
  const out = new Set<string>();
  for (const list of lists) for (const a of list) if (a.address) out.add(a.address.toLowerCase());
  return out;
}

export function sharesParticipant(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

export const SUBJECT_JOIN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Subject with only reply/forward markers removed ([tags] stay, so "[repo-a] Fix" and "[repo-b] Fix" differ). */
export function joinSubject(subject: string): string {
  let s = subject.trim();
  for (;;) {
    const next = s.replace(/^(re|fwd?|aw|sv|wg|vs|antw|tr|rv|r)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

const GENERIC_SUBJECTS = new Set([
  "hi", "hello", "hey", "test", "testing", "question", "questions", "update", "updates", "meeting", "thanks", "thank you", "follow up", "following up",
  "reminder", "invoice", "receipt", "welcome", "(no subject)", "no subject", "quick question", "checking in", "hi there", "important", "fyi", "help", "request",
]);

/** True for subjects too common to prove two messages belong together. */
export function isGenericSubject(subject: string): boolean {
  const core = joinSubject(subject).replace(/[!.?\s]+$/g, "");
  return core.length < 5 || GENERIC_SUBJECTS.has(core);
}

/** True when headers mark list, bulk or machine-generated mail, which must never join a thread by subject alone. */
export function isAutomatedHeaders(headers: Record<string, string>): boolean {
  if (headers["list-id"] || headers["list-unsubscribe"] || headers["x-github-reason"] || headers["feedback-id"]) return true;
  const auto = (headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (auto !== "" && auto !== "no") return true;
  return /^(bulk|list|junk)$/i.test((headers["precedence"] ?? "").trim());
}
