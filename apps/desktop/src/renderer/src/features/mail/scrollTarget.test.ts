import { describe, expect, it, vi } from "vitest";
import { onUserScroll } from "./scrollTarget";

/** jsdom has no layout, so scrollTop is a plain value here. */
function scroller(top: number) {
  const el = document.createElement("div");
  let value = top;
  Object.defineProperty(el, "scrollTop", { get: () => value, set: (v: number) => { value = v; } });
  return el;
}

describe("onUserScroll", () => {
  it("ignores the scroll event from the position the reader set itself", () => {
    const el = scroller(400);
    const onUser = vi.fn();
    onUserScroll(el, () => 400, onUser);
    el.dispatchEvent(new Event("scroll"));
    expect(onUser).not.toHaveBeenCalled();
  });

  it("hands the view to the user when it moves without a wheel event reaching the reader (scrolling over a mail frame)", () => {
    const el = scroller(400);
    const onUser = vi.fn();
    onUserScroll(el, () => 400, onUser);
    el.scrollTop = 520;
    el.dispatchEvent(new Event("scroll"));
    expect(onUser).toHaveBeenCalledTimes(1);
  });

  it("stops listening once cleaned up", () => {
    const el = scroller(400);
    const onUser = vi.fn();
    onUserScroll(el, () => 400, onUser)();
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
    expect(onUser).not.toHaveBeenCalled();
  });
});
