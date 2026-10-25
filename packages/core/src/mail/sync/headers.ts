/** Headers requested with every envelope fetch. */
export const FETCH_HEADERS = [
  "references", "list-unsubscribe", "list-unsubscribe-post", "list-id", "precedence", "auto-submitted", "x-flint-ref",
] as const;

/** Parses raw header lines (with folding) into lowercase names. Repeated headers keep the first value. */
export function parseHeaders(raw: Buffer | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  const unfolded = raw.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    if (!(name in out)) out[name] = line.slice(idx + 1).trim();
  }
  return out;
}

/** Message-IDs from a References header, brackets removed. */
export function parseReferences(value: string | undefined): string[] {
  if (!value) return [];
  return [...value.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]!);
}
