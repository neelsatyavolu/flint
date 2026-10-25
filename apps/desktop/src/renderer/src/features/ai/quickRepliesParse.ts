const MAX_REPLIES = 3;

const clean = (s: string) => s.replace(/^["'\s\-*\d.)]+/, "").replace(/["'\s,]+$/, "").trim();

/** Reads the three short replies out of model output: a JSON array (possibly fenced or surrounded by prose), else one reply per line. */
export function parseQuickReplies(raw: string): string[] {
  const text = raw.trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) {
        const items = parsed
          .map((p) => (typeof p === "string" ? p : p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : ""))
          .map((p) => p.trim())
          .filter(Boolean);
        if (items.length) return items.slice(0, MAX_REPLIES);
      }
    } catch {
      // Fall through to the line-based reading.
    }
  }
  return text
    .split("\n")
    .map(clean)
    .filter((l) => l && !/^```|^\[|^\]$/.test(l))
    .slice(0, MAX_REPLIES);
}
