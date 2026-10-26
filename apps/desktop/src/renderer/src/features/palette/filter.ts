import { rank } from "./fuzzy";

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
 * Fuzzy filter for the small pickers: every word of the query must match the label or keywords.
 * Prefix matches rank first, then word starts, acronyms, substrings and scattered letters; ties keep the original order.
 */
export function filterItems<T extends PickItem>(items: T[], query: string): T[] {
  if (!query.trim()) return items;
  const scored: { item: T; score: number; at: number }[] = [];
  items.forEach((item, at) => {
    const m = rank(query, item.label, item.keywords);
    if (m) scored.push({ item, score: m.score, at });
  });
  return scored.sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.item);
}
