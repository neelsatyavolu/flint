/** Finding one-time-code fields. Pure DOM reads, no side effects. */

export type CodeTarget = {
  kind: "single" | "split";
  /** One input for "single"; the row of single-character boxes, in order, for "split". */
  inputs: HTMLInputElement[];
  /** maxlength of a single field, or null when unset. Unused for split. */
  maxLength: number | null;
};

const TEXT_TYPES = new Set(["", "text", "tel", "number", "search"]);
const HINT = /\b(otp|totp|2fa|mfa|passcode|token|verification|verify|code)\b/;
const NOT_A_CODE = /\b(zip|zipcode|postal|post|promo|promotion|coupon|discount|voucher|gift|referral|invite|invitation|area|country|dial|routing|swift|sort|captcha|tracking|product|item|currency|language|card|cvv|cvc|csc|credit|billing|search)\b/;

function isInput(el: Element | null): el is HTMLInputElement {
  return !!el && el.tagName === "INPUT";
}

function isTextLike(input: HTMLInputElement): boolean {
  return TEXT_TYPES.has((input.getAttribute("type") ?? "").toLowerCase());
}

function isUsable(input: HTMLInputElement): boolean {
  if (input.disabled || input.readOnly || !isTextLike(input)) return false;
  const view = input.ownerDocument.defaultView;
  const style = view?.getComputedStyle(input);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  // A page can plant an invisible field to provoke a suggestion; a field the person cannot see gets none.
  if (style && Number.parseFloat(style.opacity || "1") < 0.1) return false;
  if (style && (px(style.width) <= 2 || px(style.height) <= 2)) return false;
  const rect = input.getBoundingClientRect();
  const empty = rect.width === 0 && rect.height === 0;
  return empty || (rect.right > 0 && rect.bottom > 0 && rect.left < (view?.innerWidth ?? Infinity) && rect.top < (view?.innerHeight ?? Infinity));
}

/** A computed length in px, or Infinity when it is not a plain px value ("auto", "50%", ""). */
function px(value: string): number {
  return /^[\d.]+px$/.test(value) ? Number.parseFloat(value) : Infinity;
}

function maxLengthOf(input: HTMLInputElement): number | null {
  const raw = input.getAttribute("maxlength");
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalize(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function labelText(input: HTMLInputElement): string {
  const parts: string[] = [];
  for (const label of Array.from(input.labels ?? [])) parts.push(label.textContent ?? "");
  const by = input.getAttribute("aria-labelledby");
  if (by) {
    const root = input.getRootNode() as Document | ShadowRoot;
    for (const id of by.split(/\s+/)) parts.push(root.getElementById?.(id)?.textContent ?? "");
  }
  return parts.join(" ");
}

function hintText(input: HTMLInputElement): string {
  const attrs = ["name", "id", "placeholder", "aria-label", "title"].map((a) => input.getAttribute(a) ?? "");
  return normalize([...attrs, labelText(input)].join(" "));
}

/** True when autocomplete names some other kind of field (cc-csc, postal-code, tel, ...). */
function hasOtherAutocomplete(input: HTMLInputElement): boolean {
  const generic = /^(one-time-code|off|on|nope|section-.*|shipping|billing|home|work|mobile|fax|pager)$/;
  return (input.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).some((t) => t !== "" && !generic.test(t));
}

const CARD_HINT = /\b(card|cc|expir\w*|expiry|exp month|exp year|cvv|cvc|csc|credit|billing)\b/;

/** True when the field sits in a payment form, where "security code" is the card's CVV. */
function inCardForm(input: HTMLInputElement): boolean {
  const scope = input.closest("form") ?? input.parentElement?.parentElement?.parentElement ?? input.parentElement;
  if (!scope) return false;
  return Array.from(scope.querySelectorAll("input")).some((i) => i !== input && ((i.getAttribute("autocomplete") ?? "").toLowerCase().startsWith("cc-") || CARD_HINT.test(hintText(i))));
}

function isSingleCodeField(input: HTMLInputElement): boolean {
  const ac = (input.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/);
  if (ac.includes("one-time-code")) return true;
  if (hasOtherAutocomplete(input)) return false;
  const max = maxLengthOf(input);
  if (max !== null && max > 10) return false;
  const hints = hintText(input);
  if (NOT_A_CODE.test(hints)) return false;
  if (/\bsecurity\b/.test(hints) && inCardForm(input)) return false;
  const inputMode = (input.getAttribute("inputmode") ?? "").toLowerCase();
  if ((inputMode === "numeric" || inputMode === "decimal") && max !== null && max >= 4 && max <= 8) return true;
  return max !== 1 && HINT.test(hints);
}

function isSplitBox(input: HTMLInputElement): boolean {
  return isTextLike(input) && !input.disabled && !input.readOnly && maxLengthOf(input) === 1;
}

/** A row of single-character boxes is a code row only with some sign of it: one-time-code autocomplete, or code words on a box or its container. */
function hasCodeHint(row: HTMLInputElement[], container: Element): boolean {
  if (row.some((i) => (i.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).includes("one-time-code"))) return true;
  const texts = row.map(hintText);
  let node: Element | null = container;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    texts.push(normalize(["id", "class", "aria-label", "data-testid"].map((a) => node!.getAttribute(a) ?? "").join(" ")));
    const own = node.textContent ?? "";
    if (own.length <= 300) texts.push(normalize(own));
  }
  const all = texts.join(" ");
  return HINT.test(all) && !NOT_A_CODE.test(all);
}

/** The row of 4 to 8 single-character boxes containing `target`, if there is one. */
function findSplitRow(target: HTMLInputElement): HTMLInputElement[] | null {
  let node: Element | null = target.parentElement;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    const row = Array.from(node.querySelectorAll("input")).filter((i) => isSplitBox(i) && isUsable(i));
    if (row.length > 8) return null;
    if (row.length >= 4 && row.includes(target)) return hasCodeHint(row, node) ? row : null;
  }
  return null;
}

/** The code target for a focused element, or null when it is not a code field. */
export function findCodeTarget(el: Element | null): CodeTarget | null {
  if (!isInput(el) || !isUsable(el)) return null;
  if (maxLengthOf(el) === 1) {
    const row = findSplitRow(el);
    return row ? { kind: "split", inputs: row, maxLength: null } : null;
  }
  return isSingleCodeField(el) ? { kind: "single", inputs: [el], maxLength: maxLengthOf(el) } : null;
}
