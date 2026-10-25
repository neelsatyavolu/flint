export type PickItem = {
  id: string;
  label: string;
  /** Right-aligned hint: a group name or a shortcut combo. */
  hint?: string;
  /** Extra words that should match. */
  keywords?: string;
  group?: string;
};

/**
 * Case-insensitive match where every word of the query must appear in the label or keywords.
 * Labels that start with a word of the query rank first, then shorter labels, then the original order.
 */
export function filterItems<T extends PickItem>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  const scored: { item: T; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const label = item.label.toLowerCase();
    const hay = `${label} ${item.keywords?.toLowerCase() ?? ""}`;
    if (!words.every((w) => hay.includes(w))) return;
    const starts = words.every((w) => label.split(/[\s/]+/).some((part) => part.startsWith(w)));
    scored.push({ item, score: (label.startsWith(words[0]!) ? 0 : starts ? 1 : 2) * 1000 + label.length, at });
  });
  return scored.sort((a, b) => a.score - b.score || a.at - b.at).map((s) => s.item);
}
