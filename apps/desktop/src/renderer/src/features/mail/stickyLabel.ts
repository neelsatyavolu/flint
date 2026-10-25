/** Start offset of each row given fixed heights. offsets[i] is the top of row i. */
export function rowOffsets(heights: number[]): number[] {
  const out = new Array<number>(heights.length);
  let y = 0;
  for (let i = 0; i < heights.length; i++) {
    out[i] = y;
    y += heights[i]!;
  }
  return out;
}

/** Index of the last label row that starts at or above `scrollTop`, or -1. */
export function activeLabelIndex(labelIndexes: number[], offsets: number[], scrollTop: number): number {
  let lo = 0;
  let hi = labelIndexes.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[labelIndexes[mid]!]! <= scrollTop) {
      found = labelIndexes[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}
