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

const REMOTE_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;

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

export type CssOptions = { allowRemote: boolean };
export type CssResult = { css: string; remoteUrls: string[] };

/**
 * Cleans a CSS string (a style block or an inline style attribute).
 * Declarations and statements that can execute script, pin content over the app (position:fixed) or
 * pull in external stylesheets are removed. Remote url() references are removed unless allowRemote.
 */
export function cleanCss(input: string, opts: CssOptions): CssResult {
  const remoteUrls: string[] = [];
  let css = input.replace(/\/\*[\s\S]*?\*\//g, "").replace(/</g, "").replace(/\u0000/g, "");
  css = css.replace(REMOTE_URL, (match) => {
    remoteUrls.push(match);
    return opts.allowRemote ? match : "none";
  });
  // Split into statements, keeping delimiters so nesting and order survive.
  const pieces = css.split(/([{};])/);
  const out: string[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const body = pieces[i] ?? "";
    const delim = pieces[i + 1] ?? "";
    if (delim !== "{" && body.trim() && isDangerous(body)) {
      if (delim === "}") out.push(delim);
      continue;
    }
    out.push(body, delim);
  }
  return { css: out.join("").trim(), remoteUrls };
}
