/**
 * Scroll position that shows the newest card in full with `clearance` of empty space below it (the floating Ask field
 * plus a gap). A card taller than the viewport is aligned to its top instead, with a small margin.
 */
export function scrollTargetTop({ cardTop, cardHeight, viewport, clearance, gap = 16 }: { cardTop: number; cardHeight: number; viewport: number; clearance: number; gap?: number }): number {
  const bottomAligned = cardTop + cardHeight + clearance - viewport;
  const topAligned = cardTop - gap;
  return Math.max(0, cardHeight + clearance + gap <= viewport ? bottomAligned : topAligned);
}

/**
 * Calls `onUser` when the scroller moves away from where the reader last put it (`placedAt`). Catches every way the user
 * scrolls, including the trackpad over a mail frame, whose wheel events stay inside the frame and never reach the reader.
 * Returns the cleanup.
 */
export function onUserScroll(scroller: HTMLElement, placedAt: () => number | null, onUser: () => void): () => void {
  const check = () => {
    const at = placedAt();
    if (at === null || Math.abs(scroller.scrollTop - at) > 1) onUser();
  };
  scroller.addEventListener("scroll", check, { passive: true });
  return () => scroller.removeEventListener("scroll", check);
}
