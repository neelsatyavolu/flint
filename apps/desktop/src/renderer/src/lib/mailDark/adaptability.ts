import { firstColor, mapBackground, toOklch } from "./color";
import { bgOf, hasImage, parseDecls } from "./css";

export type Adaptability = {
  /** False when recoloring would likely break the design: show the original on a light sheet. */
  adaptable: boolean;
  reasons: string[];
};

/** Saturated fills beyond this many distinct colors read as a designed layout that would lose its balance. */
const MAX_BRAND_FILLS = 4;
/** Mail with less text than this and a wide picture is an image with the message baked in. */
const IMAGE_ONLY_TEXT = 60;
const WIDE_IMAGE = 500;
const INLINE_IMAGE_BUDGET = 400;

const BG_IN_SHEET = /background(?:-color|-image)?\s*:\s*([^;}]+)/gi;

const isRealImage = (value: string) => {
  const m = /url\s*\(\s*(["']?)(.*?)\1\s*\)/i.exec(value);
  if (!m) return false;
  return !(m[2]!.startsWith("data:") && m[2]!.length < INLINE_IMAGE_BUDGET);
};

function brandKey(value: string): string | null {
  const c = firstColor(value);
  if (!c || c.a < 0.5) return null;
  if (!mapBackground(c).kept) return null;
  const o = toOklch(c);
  if (o.c < 0.08 || o.l < 0.25) return null;
  return `${Math.round(o.l * 10)}-${Math.round(o.h / 20)}`;
}

/** Inspects a parsed mail body (before any adaptation). Cheap: one pass over the elements plus the style text. */
export function analyzeAdaptability(body: HTMLElement, rawHtml: string): Adaptability {
  const reasons: string[] = [];
  const fills = new Set<string>();
  let backgroundImage = false;

  const noteFill = (value: string) => {
    const k = brandKey(value);
    if (k) fills.add(k);
  };

  for (const el of Array.from(body.querySelectorAll("*"))) {
    const attr = el.getAttribute("background");
    if (attr && !(/^data:/i.test(attr) && attr.length < INLINE_IMAGE_BUDGET)) backgroundImage = true;
    const bgcolor = el.getAttribute("bgcolor");
    if (bgcolor) noteFill(bgcolor);
    const style = el.getAttribute("style");
    if (!style) continue;
    const decls = parseDecls(style);
    for (const d of decls) {
      if ((d.prop === "background" || d.prop === "background-image") && hasImage(d.value) && isRealImage(d.value)) backgroundImage = true;
    }
    const own = bgOf(decls);
    if (own) noteFill(`rgb(${own.orig.r},${own.orig.g},${own.orig.b})`);
  }
  const sheets = Array.from(body.querySelectorAll("style")).map((s) => s.textContent ?? "").join("\n");
  for (const m of sheets.matchAll(BG_IN_SHEET)) {
    if (hasImage(m[1]!) && isRealImage(m[1]!)) backgroundImage = true;
    else noteFill(m[1]!);
  }
  if (/<v:(fill|background|rect|image)\b/i.test(rawHtml) && /<v:fill[^>]*\bsrc=/i.test(rawHtml)) backgroundImage = true;

  if (backgroundImage) reasons.push("background-image");
  if (fills.size >= MAX_BRAND_FILLS) reasons.push("designed-layout");

  const text = visibleText(body);
  if (text.length < IMAGE_ONLY_TEXT) {
    const wide = Array.from(body.querySelectorAll("img")).some((i) => Number(i.getAttribute("width")) >= WIDE_IMAGE);
    if (wide) reasons.push("image-only");
  }
  return { adaptable: reasons.length === 0, reasons };
}

/** Text outside <style>/<script>, collected without recursion (deeply nested mail would overflow cloneNode). */
function visibleText(body: HTMLElement): string {
  const walker = body.ownerDocument.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tag = n.parentElement?.tagName;
    if (tag !== "STYLE" && tag !== "SCRIPT") text += n.nodeValue ?? "";
  }
  return text.replace(/\s+/g, " ").trim();
}
