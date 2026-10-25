const ATTRIBUTION = /^(on .{5,200} wrote:|-{2,}\s*original message\s*-{2,}|-{2,}\s*forwarded message\s*-{2,})\s*$/i;

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
    if (isQuote || isAttribution) {
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
