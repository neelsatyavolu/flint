import type { Address } from "../types";

// Turns stored mail into a bounded prompt context: quoted replies and
// signatures are removed, the newest messages are kept within a character budget.

export const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGE_CHARS = 12_000;

const QUOTE_HEADERS: RegExp[] = [
  /^On .{5,200}wrote:\s*$/i,
  /^On .{5,200}$/i, // wrapped: "On ... <a@b>" then "wrote:" on the next line (checked below)
  /^Le .{5,200}(a écrit|à écrit)\s*:\s*$/i,
  /^Am .{5,200}schrieb .{0,200}:\s*$/i,
  /^El .{5,200}escribió:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^_{10,}\s*$/,
  /^Begin forwarded message:?\s*$/i,
];
const SIGNATURE_DELIMITER = /^--\s*$/;
const DEVICE_SIGNATURE = /^(Sent from my (iPhone|iPad|Android|Galaxy|mobile)|Sent from Outlook|Get Outlook for \w+|Sent via .{0,40}|Envoyé de mon .{0,30})\.?\s*$/i;

function isWrappedOnHeader(lines: string[], i: number): boolean {
  const line = lines[i] ?? "";
  if (!/^On .{5,200}$/i.test(line) || /wrote:\s*$/i.test(line)) return false;
  const next = lines[i + 1] ?? "";
  return /wrote:\s*$/i.test(next) && next.length < 120;
}

function isOutlookHeaderBlock(lines: string[], i: number): boolean {
  if (!/^(\*\*)?From:(\*\*)?\s+\S/i.test(lines[i] ?? "")) return false;
  const next = lines.slice(i + 1, i + 6).join("\n");
  return /^(\*\*)?(Sent|Date):/im.test(next) && /^(\*\*)?(To|Subject|Cc):/im.test(next);
}

function isQuoteStart(lines: string[], i: number): boolean {
  const line = (lines[i] ?? "").trim();
  if (isWrappedOnHeader(lines, i)) return true;
  if (/^On .{5,200}$/i.test(line)) return /wrote:\s*$/i.test(line);
  if (QUOTE_HEADERS.some((re, idx) => idx !== 1 && re.test(line))) {
    // A rule of underscores is only a quote start when an Outlook header follows.
    if (/^_{10,}$/.test(line)) return isOutlookHeaderBlock(lines, i + 1) || isOutlookHeaderBlock(lines, i + 2);
    return true;
  }
  return isOutlookHeaderBlock(lines, i);
}

/** Removes quoted replies, forwarded-reply chains and signatures from a plain-text body. */
export function stripQuotedAndSignature(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    if (SIGNATURE_DELIMITER.test(raw)) break;
    if (isQuoteStart(lines, i)) break;
    if (/^\s*>/.test(raw)) continue;
    kept.push(raw.replace(/\s+$/, ""));
  }
  while (kept.length && DEVICE_SIGNATURE.test((kept[kept.length - 1] ?? "").trim())) kept.pop();
  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned) return cleaned;
  // The message was all quote or all signature: fall back to the raw text without ">" lines.
  return lines.filter((l) => !/^\s*>/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatAddress(a: Address): string {
  return a.name && a.name !== a.address ? `${a.name} <${a.address}>` : a.address;
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export type AiMessage = { from: Address; to: Address[]; date: number; text: string };

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + "\n[message truncated]";
}

/** Escapes anything that could close the tag the thread is wrapped in. */
export function neutralizeTags(text: string): string {
  return text.replace(/<\/?\s*(email_thread|mail_excerpts|draft|text)\b/gi, (m) => m.replace("<", "&lt;"));
}

/**
 * Formats the newest messages that fit the budget, oldest first.
 * Returns the text and how many older messages were left out.
 */
export function buildThreadContext(messages: AiMessage[], maxChars = MAX_CONTEXT_CHARS): { text: string; omitted: number } {
  const blocks: string[] = [];
  let used = 0;
  let included = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const body = truncate(stripQuotedAndSignature(m.text), MAX_MESSAGE_CHARS) || "(no text)";
    const block = `From: ${formatAddress(m.from)}\nTo: ${m.to.map(formatAddress).join(", ") || "(none)"}\nDate: ${formatDate(m.date)}\n\n${body}`;
    if (included > 0 && used + block.length > maxChars) break;
    blocks.unshift(block);
    used += block.length;
    included += 1;
  }
  const omitted = messages.length - included;
  const header = omitted > 0 ? `(${omitted} earlier message${omitted === 1 ? "" : "s"} omitted)\n\n` : "";
  return { text: neutralizeTags(header + blocks.join("\n\n---\n\n")), omitted };
}
