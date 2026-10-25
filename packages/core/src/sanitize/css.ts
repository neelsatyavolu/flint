/** CSS cleaning for inline styles and <style> blocks. Newsletters need CSS, so we keep it and drop only what can execute or escape. */

const DANGEROUS = [
  /expression\s*\(/i,
  /-moz-binding/i,
  /\bbehavior\s*:/i,
  /javascript\s*:/i,
  /vbscript\s*:/i,
  /position\s*:\s*(?:fixed|sticky)/i,
  /@import/i,
  /@charset/i,
];

/** Tokens that can start a remote reference. Matching only the opener keeps scanning linear. */
const REF_OPEN = /(?:-webkit-)?image-set\(|url\(/gi;
const REMOTE_START = /^\s*['"]?\s*(?:https?:)?\/\//i;
const REMOTE_STRING = /['"]\s*(?:https?:)?\/\//i;

/** A single style attribute or block larger than this is dropped; real mail CSS is far smaller. */
export const MAX_CSS_LENGTH = 512 * 1024;

/** Decodes CSS escapes so `p\6fsition:fixed` is checked as `position:fixed`. */
export function decodeCssEscapes(css: string): string {
  return css
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_m, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    })
    .replace(/\\(.)/gs, "$1");
}

function isDangerous(piece: string): boolean {
  const decoded = decodeCssEscapes(piece).replace(/\s+/g, " ");
  return DANGEROUS.some((re) => re.test(decoded));
}

/** Removes comments in one linear pass. An unterminated comment swallows the rest, as browsers do. */
function stripComments(css: string): string {
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    const open = css.indexOf("/*", pos);
    if (open === -1) {
      parts.push(css.slice(pos));
      break;
    }
    parts.push(css.slice(pos, open));
    const close = css.indexOf("*/", open + 2);
    if (close === -1) break;
    pos = close + 2;
  }
  return parts.join("");
}

/** Index just past the ")" closing a group whose contents start at `from`, or -1. Honors nesting and quotes. */
function groupEnd(css: string, from: number): number {
  let depth = 1;
  let quote = "";
  for (let i = from; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Replaces remote url(...) and image-set(...) references in a single pass that never rescans text, so hostile
 * input (thousands of unclosed "url(") stays linear. An unclosed reference runs to the end, like in a browser.
 */
function replaceRemoteRefs(css: string, replace: (match: string) => string): string {
  const re = new RegExp(REF_OPEN.source, "gi");
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    const m = re.exec(css);
    if (!m) break;
    const argStart = m.index + m[0].length;
    const isSet = m[0].toLowerCase().endsWith("image-set(");
    if (!isSet && !REMOTE_START.test(css.slice(argStart, argStart + 64))) continue;
    const end = isSet ? groupEnd(css, argStart) : css.indexOf(")", argStart) + 1;
    const stop = end <= 0 ? css.length : end;
    const whole = css.slice(m.index, stop);
    if (isSet && !REMOTE_STRING.test(whole) && !/url\(\s*['"]?\s*(?:https?:)?\/\//i.test(whole)) continue;
    parts.push(css.slice(pos, m.index), replace(whole));
    pos = stop;
    re.lastIndex = stop;
  }
  parts.push(css.slice(pos));
  return parts.join("");
}

export type CssOptions = { allowRemote: boolean };
export type CssResult = { css: string; remoteUrls: string[] };

/**
 * Cleans a CSS string (a style block or an inline style attribute).
 * Declarations and statements that can execute script, pin content over the app (position:fixed) or
 * pull in external stylesheets are removed. Remote url() references are removed unless allowRemote.
 */
export function cleanCss(input: string, opts: CssOptions): CssResult {
  if (input.length > MAX_CSS_LENGTH) return { css: "", remoteUrls: [] };
  let css = stripComments(input).replace(/</g, "").replace(/\u0000/g, "");

  const run = (text: string) => {
    const found: string[] = [];
    const out = replaceRemoteRefs(text, (match) => {
      found.push(match);
      return opts.allowRemote ? match : "none";
    });
    return { out, found };
  };

  let { out, found } = run(css);
  if (css.includes("\\")) {
    // Escapes like \75rl( or url(\68ttps://) hide a remote reference from the raw text. When the decoded form
    // has more references than the raw form, continue with the decoded text so they are caught.
    const viaDecoded = run(decodeCssEscapes(css));
    if (viaDecoded.found.length > found.length) ({ out, found } = viaDecoded);
  }
  css = out;
  const remoteUrls = found;

  // Split into statements, keeping delimiters so nesting and order survive.
  const pieces = css.split(/([{};])/);
  const result: string[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const body = pieces[i] ?? "";
    const delim = pieces[i + 1] ?? "";
    if (delim !== "{" && body.trim() && isDangerous(body)) {
      if (delim === "}") result.push(delim);
      continue;
    }
    result.push(body, delim);
  }
  return { css: result.join("").trim(), remoteUrls };
}
