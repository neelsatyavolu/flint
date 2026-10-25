import type { KeyboardEvent } from "react";

/** Arrow/Home/End navigation for a row of tabs or radios. `move(next)` receives the target index. */
export function rovingKeyDown(e: KeyboardEvent, index: number, count: number, move: (next: number) => void): void {
  let next = index;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown": next = (index + 1) % count; break;
    case "ArrowLeft":
    case "ArrowUp": next = (index - 1 + count) % count; break;
    case "Home": next = 0; break;
    case "End": next = count - 1; break;
    default: return;
  }
  e.preventDefault();
  move(next);
}
