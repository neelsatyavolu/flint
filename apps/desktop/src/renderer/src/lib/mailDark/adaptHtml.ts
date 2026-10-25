import { DARK, ensureContrast, formatColor, mapBackground, mapText, parseColor, type Rgba } from "./color";
import { bgOf, mapDecls, mapStyleSheet, parseDecls, serializeDecls } from "./css";

type Ctx = { under: Rgba; kept: boolean; fg: Rgba };

const SKIP = new Set(["SCRIPT", "SVG", "HEAD", "TEMPLATE", "NOSCRIPT"]);
const SIGNATURE_HINT = /(gmail_signature|moz-signature|signature|(^|[\s_-])sig([\s_-]|$))/i;
const LOGO_HINT = /logo|brand|wordmark/i;
const FLAT_IMAGE = /\.(png|svg|gif|webp)(\?|#|$)|^data:image\/(png|svg\+xml|gif|webp)/i;
const PLATE = "background:#ffffff;padding:2px 4px;border-radius:2px";

/** Logo-sized PNG/SVG/GIF images in a signature or called "logo" can have transparent dark art: give them a light plate. */
function needsPlate(img: Element): boolean {
  const src = img.getAttribute("src") ?? "";
  if (!FLAT_IMAGE.test(src)) return false;
  if (Number(img.getAttribute("width")) > 260) return false;
  if (/background(-color)?\s*:/i.test(img.getAttribute("style") ?? "")) return false;
  const hint = `${img.getAttribute("alt") ?? ""} ${img.getAttribute("class") ?? ""} ${img.getAttribute("id") ?? ""} ${src.startsWith("data:") ? "" : src}`;
  if (LOGO_HINT.test(hint)) return true;
  for (let p: Element | null = img.parentElement; p; p = p.parentElement) {
    const marks = `${p.getAttribute("class") ?? ""} ${p.getAttribute("id") ?? ""} ${p.getAttribute("data-smartmail") ?? ""}`;
    if (SIGNATURE_HINT.test(marks)) return true;
  }
  return false;
}

function adaptElement(el: Element, ctx: Ctx): Ctx {
  const original = parseDecls(el.getAttribute("style") ?? "");
  let under = ctx.under;
  let kept = ctx.kept;

  // Own background. The bgcolor attribute loses to an inline style, like in a browser.
  const attrBg = el.getAttribute("bgcolor");
  const attrColor = attrBg ? parseColor(attrBg) : null;
  let own = bgOf(original);
  if (!own && attrColor && attrColor.a >= 0.5) {
    const m = mapBackground(attrColor);
    own = { orig: attrColor, mapped: m.color, kept: m.kept };
  }
  if (attrColor && attrColor.a >= 0.5) el.setAttribute("bgcolor", formatColor(own?.mapped ?? attrColor));
  if (own) {
    under = own.mapped;
    kept = own.kept;
  }

  const isAnchor = el.tagName === "A";
  const link = isAnchor && !own;
  const { decls: mapped, text } = mapDecls(original, { under, underKept: kept, link });
  let fg = text ?? ctx.fg;
  const out = [...mapped];

  // <font color> and <body text>.
  const attr = el.tagName === "BODY" ? "text" : el.tagName === "FONT" || el.tagName === "BASEFONT" ? "color" : null;
  const attrText = attr ? parseColor(el.getAttribute(attr) ?? "") : null;
  if (attr && attrText) {
    fg = link && !kept ? parseColor(DARK.accent)! : ensureContrast(kept ? attrText : mapText(attrText), under);
    el.setAttribute(attr, formatColor(fg));
  } else if (text === null && isAnchor && !own) {
    // A plain link: accent on the card, the surrounding text color on a kept (dark or saturated) fill.
    fg = kept ? ensureContrast(ctx.fg, under) : parseColor(DARK.accent)!;
    out.push({ prop: "color", value: formatColor(fg) });
  } else if (text === null && own) {
    const readable = ensureContrast(ctx.fg, under);
    if (readable !== ctx.fg) {
      // Inherited text would not read on the new fill.
      fg = readable;
      out.push({ prop: "color", value: formatColor(readable) });
    }
  }

  const before = serializeDecls(original);
  const after = serializeDecls(out);
  if (after !== before) el.setAttribute("style", after);
  return { under, kept, fg };
}

/** Adapts a parsed document body in place. Iterative so a deeply nested table cannot overflow the stack. */
export function adaptBody(body: HTMLElement): void {
  const root: Ctx = { under: parseColor(DARK.bg)!, kept: false, fg: parseColor(DARK.fg)! };
  const stack: [Element, Ctx][] = [[body, root]];
  while (stack.length) {
    const [el, ctx] = stack.pop()!;
    const tag = el.tagName.toUpperCase();
    if (tag === "STYLE") {
      el.textContent = mapStyleSheet(el.textContent ?? "");
      continue;
    }
    if (tag === "IMG") {
      if (needsPlate(el)) {
        const style = el.getAttribute("style");
        el.setAttribute("style", style ? `${style};${PLATE}` : PLATE);
      }
      continue;
    }
    if (SKIP.has(tag)) continue;
    const next = adaptElement(el, ctx);
    for (let i = el.children.length - 1; i >= 0; i--) stack.push([el.children[i]!, next]);
  }
  for (const s of Array.from(body.ownerDocument.head.querySelectorAll("style"))) s.textContent = mapStyleSheet(s.textContent ?? "");
}
