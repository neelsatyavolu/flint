import { DARK, ensureContrast, firstColor, formatColor, mapBackground, mapBorder, mapText, parseColor, replaceColors, type Rgba } from "./color";

export type Decl = { prop: string; value: string };

/** Splits a declaration list on semicolons outside parentheses and quotes. */
export function parseDecls(text: string): Decl[] {
  const out: Decl[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  const push = (end: number) => {
    const part = text.slice(start, end);
    const i = part.indexOf(":");
    if (i > 0) out.push({ prop: part.slice(0, i).trim().toLowerCase(), value: part.slice(i + 1).trim() });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === ";" && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return out;
}

export const serializeDecls = (decls: Decl[]): string => decls.map((d) => `${d.prop}:${d.value}`).join(";");

export const isBgProp = (p: string) => p === "background" || p === "background-color";
const isBorderProp = (p: string) => /^(border|outline)(-(top|right|bottom|left))?(-color)?$/.test(p) ;

/** Whether a background declaration paints an image (url() or a gradient). */
export const hasImage = (value: string) => /url\s*\(/i.test(value);

/** The mapped background of a declaration list, or null when it sets none that we can read. */
export function bgOf(decls: Decl[]): { orig: Rgba; mapped: Rgba; kept: boolean } | null {
  for (const d of decls) {
    if (!isBgProp(d.prop)) continue;
    const c = firstColor(d.value);
    if (!c || c.a < 0.5) continue;
    const m = mapBackground(c);
    return { orig: c, mapped: m.color, kept: m.kept };
  }
  return null;
}

type Env = {
  /** Background the element ends up on, when the element or an ancestor set one; THEME bg otherwise. */
  under: Rgba;
  /** True when that background was kept as authored (dark or saturated). */
  underKept: boolean;
  /** Anchor with no own background: the accent. */
  link: boolean;
};

/**
 * Maps every color-bearing declaration. Shared by inline styles (where `env` comes from the DOM
 * walk) and rule bodies (where it comes from the rule itself). Returns the decls and the
 * text color the element ends up with (null when it sets none).
 */
export function mapDecls(decls: Decl[], env: Env): { decls: Decl[]; text: Rgba | null } {
  let text: Rgba | null = null;
  const next = decls.map((d): Decl => {
    if (isBgProp(d.prop)) {
      if (!firstColor(d.value)) return d;
      return { ...d, value: replaceColors(d.value, (c) => (c.a < 0.5 ? c : mapBackground(c).color)) };
    }
    if (d.prop === "color") {
      const c = parseColor(d.value);
      if (!c) return d;
      const important = /!important\s*$/i.test(d.value) ? " !important" : "";
      let out: Rgba;
      if (env.link && !env.underKept) out = parseColor(DARK.accent)!;
      else out = ensureContrast(env.underKept ? c : mapText(c), env.under);
      text = out;
      return { ...d, value: formatColor(out) + important };
    }
    if (isBorderProp(d.prop)) return { ...d, value: replaceColors(d.value, mapBorder) };
    return d;
  });
  return { decls: next, text };
}

const LINK_SELECTOR = /(^|[\s>+~])a(:[\w-]+|\.[\w-]+|\[[^\]]*\])*$/i;
const isLinkSelector = (sel: string) => sel.split(",").some((p) => LINK_SELECTOR.test(p.trim()) || /hyperlink/i.test(p));

/** Maps colors inside <style> text, rule by rule. */
export function mapStyleSheet(css: string): string {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, selector: string, body: string) => {
    if (/^\s*@(font-face|keyframes|page)/i.test(selector)) return whole;
    const decls = parseDecls(body);
    if (!decls.some((d) => isBgProp(d.prop) || d.prop === "color" || isBorderProp(d.prop))) return whole;
    const bg = bgOf(decls);
    const link = bg === null && isLinkSelector(selector);
    const { decls: mapped } = mapDecls(decls, {
      under: bg?.mapped ?? parseColor(DARK.bg)!,
      underKept: bg?.kept ?? false,
      link,
    });
    const hasText = mapped.some((d) => d.prop === "color");
    if (bg?.kept && !hasText && ensureContrast(parseColor(DARK.fg)!, bg.mapped) !== parseColor(DARK.fg)) {
      mapped.push({ prop: "color", value: formatColor(ensureContrast(parseColor(DARK.fg)!, bg.mapped)) });
    }
    return `${selector}{${serializeDecls(mapped)}}`;
  });
}
