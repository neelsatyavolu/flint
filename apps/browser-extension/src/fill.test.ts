import { describe, expect, it, vi } from "vitest";
import { findCodeTarget } from "./fields";
import { fillTarget, fitCode } from "./fill";

function single(attrs: string) {
  document.body.innerHTML = `<input id="x" autocomplete="one-time-code" ${attrs}>`;
  const el = document.querySelector<HTMLInputElement>("#x")!;
  return { el, target: findCodeTarget(el)! };
}

describe("fitCode", () => {
  it("keeps the code when it fits", () => expect(fitCode(single("").target, "X67-UJK")).toBe("X67-UJK"));
  it("drops the dash when only that makes it fit", () => expect(fitCode(single('maxlength="6"').target, "X67-UJK")).toBe("X67UJK"));
  it("rejects a code that cannot fit", () => expect(fitCode(single('maxlength="4"').target, "530331")).toBeNull());
  it("requires an exact length for split rows", () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<input id="b${i}" maxlength="1" autocomplete="one-time-code">`).join("");
    const t = findCodeTarget(document.querySelector("#b0"))!;
    expect(fitCode(t, "530331")).toBe("530331");
    expect(fitCode(t, "5303")).toBeNull();
  });
});

describe("fillTarget", () => {
  it("fills a single field and fires input, change and keyup", () => {
    const { el, target } = single("");
    const seen: string[] = [];
    for (const t of ["input", "change", "keyup"]) el.addEventListener(t, () => seen.push(`${t}:${el.value}`));
    expect(fillTarget(target, "530331")).toBe(true);
    expect(el.value).toBe("530331");
    expect(seen).toEqual(["input:530331", "change:530331", "keyup:530331"]);
  });

  it("uses the native setter so a value tracker sees the change", () => {
    const { el, target } = single("");
    let tracked = "";
    const proto = Object.getPrototypeOf(el) as object;
    const native = Object.getOwnPropertyDescriptor(proto, "value")!;
    // Simulates React's per-element tracker, which shadows the prototype setter on the instance.
    Object.defineProperty(el, "value", { configurable: true, get: () => native.get!.call(el), set: (v: string) => { tracked = v; native.set!.call(el, v); } });
    fillTarget(target, "123456");
    expect(tracked).toBe("");
    expect(el.value).toBe("123456");
  });

  it("fills a split row one character per box and focuses the last", () => {
    document.body.innerHTML = Array.from({ length: 6 }, (_, i) => `<input id="b${i}" maxlength="1" autocomplete="one-time-code">`).join("");
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
    const onInput = vi.fn();
    inputs.forEach((i) => i.addEventListener("input", onInput));
    const target = findCodeTarget(inputs[0]!)!;
    expect(fillTarget(target, "17728")).toBe(false);
    expect(fillTarget(target, "177284")).toBe(true);
    expect(inputs.map((i) => i.value).join("")).toBe("177284");
    expect(onInput).toHaveBeenCalledTimes(6);
    expect(document.activeElement).toBe(inputs[5]);
  });

  it("does not fit an alphanumeric code into a number input, and keeps digits", () => {
    const { el, target } = single('type="number"');
    expect(fitCode(target, "X67-UJK")).toBeNull();
    expect(fillTarget(target, "X67-UJK")).toBe(false);
    expect(el.value).toBe("");
    expect(fillTarget(target, "530331")).toBe(true);
    expect(el.value).toBe("530331");
  });

  it("does nothing when the code does not fit", () => {
    const { el, target } = single('maxlength="4"');
    expect(fillTarget(target, "530331")).toBe(false);
    expect(el.value).toBe("");
  });
});
