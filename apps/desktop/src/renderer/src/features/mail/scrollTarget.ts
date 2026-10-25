/**
 * Scroll position that shows the newest card in full with `clearance` of empty space below it (the floating Ask field
 * plus a gap). A card taller than the viewport is aligned to its top instead, with a small margin.
 */
export function scrollTargetTop({ cardTop, cardHeight, viewport, clearance, gap = 16 }: { cardTop: number; cardHeight: number; viewport: number; clearance: number; gap?: number }): number {
  const bottomAligned = cardTop + cardHeight + clearance - viewport;
  const topAligned = cardTop - gap;
  return Math.max(0, cardHeight + clearance + gap <= viewport ? bottomAligned : topAligned);
}
