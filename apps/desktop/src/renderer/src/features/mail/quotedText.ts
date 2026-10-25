const ATTRIBUTION = /^(on .{5,200} wrote:|-{2,}\s*original message\s*-{2,}|-{2,}\s*forwarded message\s*-{2,})\s*$/i;
/** Outlook puts "From: ..." and "Sent: ..." (or "Date: ...") header lines in front of the quoted mail. */
const OUTLOOK_HEADER = /^\s*from:[\s\S]{1,300}?(sent|date):/i;
const FORWARDED = /^-{2,}\s*forwarded message\s*-{2,}/i;
const FORWARD_SUBJECT = /^\s*(fwd?|fw)\s*:/i;
const WROTE_LINE = /^\s*(on .{5,200} wrote:|-{2,}\s*original message\s*-{2,})\s*$/i;

/**
 * Splits a plain-text reply into what the sender wrote and the quoted tail ("> ..." lines with
 * their "On ... wrote:" line). Returns an empty `quoted` when nothing is clearly quoted or when
 * the whole message is a quote.
 */
export function splitQuoted(text: string): { body: string; quoted: string } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nextFilled = (from: number) => lines.slice(from).find((l) => l.trim() !== "");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const isQuote = line.startsWith(">");
    const isAttribution = ATTRIBUTION.test(line.trim()) && (nextFilled(i + 1)?.startsWith(">") ?? false);
    const isOutlook = /^-{2,}\s*original message\s*-{2,}$/i.test(line.trim()) || (/^from:/i.test(line.trim()) && OUTLOOK_HEADER.test(lines.slice(i, i + 5).join("\n")));
    if (isQuote || isAttribution || isOutlook) {
      start = i;
      break;
    }
  }
  if (start <= 0) return { body: text, quoted: "" };
  const body = lines.slice(0, start).join("\n").trimEnd();
  if (body === "") return { body: text, quoted: "" };
  return { body, quoted: lines.slice(start).join("\n").trim() };
}

/** Rough word count of a message for the summary threshold. */
export function wordCount(message: { text: string | null; html: string | null }): number {
  const source = message.text ?? (message.html ?? "").replace(/<style[\s\S]*?<\/style>|<[^>]+>/g, " ");
  return source.split(/\s+/).filter(Boolean).length;
}

/** True when the HTML references an https image, so the blocked-images notice is worth showing. */
export function hasRemoteImages(html: string | null): boolean {
  return html !== null && /<img[^>]+src\s*=\s*["']?https?:\/\//i.test(html);
}

/** Which messages start expanded: the last one and the newest unread one. */
export function initialExpanded(messages: { id: number; seen: boolean }[]): Set<number> {
  const out = new Set<number>();
  const last = messages.at(-1);
  if (last) out.add(last.id);
  const unread = [...messages].reverse().find((m) => !m.seen);
  if (unread) out.add(unread.id);
  return out;
}

const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

/** The first element that begins quoted history, by any of the known mail clients' markers. */
function findQuoteStart(doc: Document): Element | null {
  const found: Element[] = [];
  const add = (el: Element | null) => {
    if (el) found.push(el);
  };
  // Gmail, Apple Mail, Outlook web.
  // Gmail wraps forwarded messages in the same div, so a "Forwarded message" block is content, not history.
  const marked = Array.from(doc.querySelectorAll("div.gmail_quote, blockquote.gmail_quote, .gmail_quote_container, blockquote[type='cite'], #divRplyFwdMsg, #appendonsend"));
  const forwarded = marked.filter((el) => FORWARDED.test(textOf(el).slice(0, 120)));
  add(marked.find((el) => !forwarded.includes(el)) ?? null);
  for (const el of Array.from(doc.body.querySelectorAll("div, p, span, font, blockquote"))) {
    if (forwarded.some((f) => f.contains(el))) continue;
    const text = textOf(el);
    if (text.length > 400) {
      if (OUTLOOK_HEADER.test(text.slice(0, 400)) && /^\s*from:/i.test(text)) {
        add(el);
        break;
      }
      continue;
    }
    if (WROTE_LINE.test(text) || (/^from:/i.test(text) && OUTLOOK_HEADER.test(text))) {
      add(el);
      break;
    }
  }
  if (found.length === 0) return null;
  found.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  let start = found[0]!;
  const prev = start.previousElementSibling;
  if (prev && (prev.tagName === "HR" || (prev.tagName !== "BLOCKQUOTE" && WROTE_LINE.test(textOf(prev))))) start = prev;
  return start;
}

/** Drops `start` and everything after it (keep "before"), or everything before it (keep "after"), at every nesting level. */
function partition(doc: Document, start: Element, keep: "before" | "after") {
  let node: Element | null = start;
  let first = true;
  while (node && node !== doc.body) {
    const parent: Element | null = node.parentElement;
    if (keep === "before") {
      let sib: ChildNode | null = first ? node : node.nextSibling;
      while (sib) {
        const next: ChildNode | null = sib.nextSibling;
        sib.remove();
        sib = next;
      }
    } else {
      let sib: ChildNode | null = node.previousSibling;
      while (sib) {
        const prev: ChildNode | null = sib.previousSibling;
        sib.remove();
        sib = prev;
      }
    }
    first = false;
    node = parent;
  }
}

/**
 * Splits mail HTML into what the sender wrote and the quoted history behind it. Returns `quoted: null` when no quote
 * marker is found or when nothing is left above it (a message that is only a quote stays whole). Both halves keep the
 * original <head>, so styles apply to each.
 */
export function splitQuotedHtml(html: string, subject = ""): { body: string; quoted: string | null } {
  // A forward's content is the point of the message, so nothing in it is hidden.
  if (typeof DOMParser === "undefined" || FORWARD_SUBJECT.test(subject)) return { body: html, quoted: null };
  const parse = () => new DOMParser().parseFromString(html, "text/html");
  const doc = parse();
  const start = findQuoteStart(doc);
  if (!start) return { body: html, quoted: null };
  const index = Array.from(doc.querySelectorAll("*")).indexOf(start);
  const rest = parse();
  const restStart = rest.querySelectorAll("*")[index];
  if (!restStart) return { body: html, quoted: null };
  partition(doc, start, "before");
  const hasContent = (doc.body.textContent ?? "").trim() !== "" || doc.body.querySelector("img, table, video") !== null;
  if (!hasContent) return { body: html, quoted: null };
  partition(rest, restStart, "after");
  return { body: doc.documentElement.outerHTML, quoted: rest.documentElement.outerHTML };
}
