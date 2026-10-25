import type { Settings } from "@flint/core";

export const LABEL_ROW_HEIGHT = 28;

/** Thread row height from density and preview lines. Comfortable with one preview line is 76. */
export function rowHeight(density: Settings["appearance"]["density"], previewLines: Settings["appearance"]["previewLines"]): number {
  if (density === "compact") return 56;
  if (previewLines === 0) return 56;
  return previewLines === 2 ? 96 : 76;
}
