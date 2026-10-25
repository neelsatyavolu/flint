export type DigestItem = { text: string; threadId: number | null; subject: string };
export type DigestGroup = { title: string | null; items: DigestItem[] };
export type ParsedDigest = { groups: DigestGroup[]; notes: string[] };

const MARKER = /\[(\d{1,2})\]/g;
const TRAILING_PARTIAL = /\s*\[\d{0,2}\]?(?:\[\d{0,2}\]?)*$/;

/**
 * Splits a streamed digest into titled groups of bullets. Each bullet ends with the [n] of the thread
 * it is about; `threads[n - 1]` is that thread (the backend keeps the two aligned). Lines that are not
 * bullets are group titles when a bullet follows them, closing notes otherwise.
 */
export function parseDigest(text: string, threads: { threadId: number; subject: string }[]): ParsedDigest {
  const groups: DigestGroup[] = [];
  const notes: string[] = [];
  let pendingTitle: string | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (!bullet) {
      if (pendingTitle !== null) notes.push(pendingTitle);
      pendingTitle = line;
      continue;
    }
    const body = bullet[1]!;
    const n = Number([...body.matchAll(MARKER)][0]?.[1]);
    const thread = Number.isInteger(n) ? threads[n - 1] : undefined;
    const clean = body.replace(MARKER, "").replace(TRAILING_PARTIAL, "").replace(/\s{2,}/g, " ").trim();
    const last = groups.at(-1);
    const title = pendingTitle;
    pendingTitle = null;
    const item: DigestItem = { text: clean, threadId: thread?.threadId ?? null, subject: thread?.subject ?? "" };
    if (title !== null || !last) groups.push({ title, items: [item] });
    else last.items.push(item);
  }
  if (pendingTitle !== null) {
    // A trailing plain line is a note when it reads like a sentence, a group title still being streamed otherwise.
    if (/[.!]$/.test(pendingTitle) || pendingTitle.length > 40 || groups.length > 0 && !/^[A-Z][\w ]{2,38}$/.test(pendingTitle)) notes.push(pendingTitle);
    else groups.push({ title: pendingTitle, items: [] });
  }
  return { groups, notes };
}
