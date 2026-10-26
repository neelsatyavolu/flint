import type { CodeTarget } from "./fields";

/** The text to type for `code` in `target`, or null when it cannot fit. Drops the dash of an alphanumeric code when needed. */
export function fitCode(target: CodeTarget, code: string): string | null {
  const bare = code.replace(/[-\s]/g, "");
  const numeric = target.inputs.some((i) => (i.getAttribute("type") ?? "").toLowerCase() === "number");
  // A type=number box sanitizes anything but digits to an empty value.
  const ok = (text: string): boolean => !numeric || /^\d+$/.test(text);
  if (target.kind === "split") return bare.length === target.inputs.length && ok(bare) ? bare : null;
  const max = target.maxLength;
  if (max === null || code.length <= max) return ok(code) ? code : null;
  return bare.length <= max && ok(bare) ? bare : null;
}

function setValue(input: HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(input) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  // The prototype setter bypasses the value tracker React installs on the element, so React sees the change.
  if (setter) setter.call(input, value);
  else input.value = value;
}

function notify(input: HTMLInputElement, value: string): void {
  const view = input.ownerDocument.defaultView ?? window;
  const key = value.slice(-1);
  input.dispatchEvent(new view.InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new view.Event("change", { bubbles: true }));
  input.dispatchEvent(new view.KeyboardEvent("keyup", { bubbles: true, composed: true, key }));
}

/** Types `code` into the target. Returns false when it does not fit. */
export function fillTarget(target: CodeTarget, code: string): boolean {
  const text = fitCode(target, code);
  if (text === null) return false;
  if (target.kind === "single") {
    const input = target.inputs[0];
    if (!input) return false;
    input.focus();
    setValue(input, text);
    if (input.value !== text) return false;
    notify(input, text);
    return true;
  }
  let accepted = true;
  target.inputs.forEach((input, i) => {
    const ch = text[i] ?? "";
    input.focus();
    setValue(input, ch);
    if (input.value !== ch) accepted = false;
    notify(input, ch);
  });
  target.inputs[target.inputs.length - 1]?.focus();
  return accepted;
}
