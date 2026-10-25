/**
 * Helpers for rendering mail in the reader iframe.
 *
 * Sandbox choice: `allow-same-origin allow-popups allow-popups-to-escape-sandbox`, never allow-scripts.
 * Without allow-same-origin the frame gets an opaque origin and the parent cannot read
 * contentDocument (so it cannot measure the content height or intercept link clicks; this was
 * checked: contentDocument is null cross-origin). Without allow-scripts, nothing inside the frame
 * can execute, so same-origin access only ever flows parent -> frame. The srcdoc also carries a CSP
 * meta that blocks scripts, forms, frames and, unless images were allowed, remote loads. core
 * additionally sanitizes the HTML before it reaches the renderer.
 */

export const MAIL_FRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export type SrcdocOptions = {
  html: string;
  /** Remote https images load only when true (data: and flint-attachment: always work). */
  allowRemoteImages: boolean;
  /** Plain text/AI prose follows the theme; HTML mail gets a white sheet. `line` colors blockquote rules. */
  colors?: { bg: string; fg: string; link: string; line?: string };
  /** "dark" tells the frame to use dark scrollbars and form controls. Defaults to light, like the white sheet. */
  scheme?: "light" | "dark";
  padding?: number;
};

const WHITE_SHEET: NonNullable<SrcdocOptions["colors"]> = { bg: "#ffffff", fg: "#1a1a17", link: "#2f6fe0" };

export function buildCsp(allowRemoteImages: boolean): string {
  const img = allowRemoteImages ? "img-src data: flint-attachment: https:" : "img-src data: flint-attachment:";
  const font = allowRemoteImages ? "font-src https: data:" : "font-src data:";
  return `default-src 'none'; ${img}; ${font}; style-src 'unsafe-inline'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
}

const LOCAL_SRC = /^(data:|flint-attachment:|cid:|blob:)/i;

/**
 * Swaps every remote <img> for a neutral box of the same size, so blocked images read as a
 * deliberate placeholder instead of a broken-image glyph with alt text. Parsing with DOMParser
 * runs no script and loads nothing.
 */
export function blockRemoteImages(html: string): string {
  if (typeof DOMParser === "undefined" || !/<img\b/i.test(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const img of Array.from(doc.body.querySelectorAll("img"))) {
    const src = (img.getAttribute("src") ?? "").trim();
    if (src !== "" && LOCAL_SRC.test(src)) continue;
    const box = doc.createElement("span");
    box.className = "flint-blocked-img";
    box.setAttribute("role", "img");
    const alt = img.getAttribute("alt");
    if (alt) box.setAttribute("aria-label", alt);
    const px = (v: string | null) => (v && /^\d{1,4}$/.test(v.trim()) ? Number(v) : null);
    const w = px(img.getAttribute("width"));
    const h = px(img.getAttribute("height"));
    if (w !== null && w > 1) box.style.width = `${w}px`;
    if (h !== null && h > 1) {
      box.style.height = `${h}px`;
      box.style.minHeight = "0";
    } else if (w !== null && w > 1 && w <= 96) {
      box.style.height = `${w}px`; // icons and avatars stay small
      box.style.minHeight = "0";
    }
    img.replaceWith(box);
  }
  return doc.body.innerHTML;
}

export function buildSrcdoc(opts: SrcdocOptions): string {
  const c = opts.colors ?? WHITE_SHEET;
  const html = opts.allowRemoteImages ? opts.html : blockRemoteImages(opts.html);
  const pad = opts.padding ?? 16;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${buildCsp(opts.allowRemoteImages)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
html{background:${c.bg};color-scheme:${opts.scheme ?? "light"}}
body{margin:0;padding:${pad}px;background:${c.bg};color:${c.fg};font:14.5px/1.5 "Geist Variable",ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;overflow-wrap:anywhere;word-break:normal;-webkit-font-smoothing:antialiased}
a{color:${c.link}}
img{max-width:100%;height:auto}
.flint-blocked-img{display:inline-block;box-sizing:border-box;width:100%;max-width:100%;min-height:48px;background:rgba(128,128,128,.12);border-radius:2px;vertical-align:top}
table{max-width:100%}
blockquote{margin:0 0 0 4px;padding-left:12px;border-left:2px solid ${c.line ?? "rgba(128,128,128,.35)"};color:inherit;opacity:.85}
pre{white-space:pre-wrap}
body>:last-child{margin-bottom:0}
</style></head><body>${html}</body></html>`;
}

/** Visible text of an HTML fragment, whitespace collapsed. Parsing runs no script and loads nothing. */
export function htmlToText(html: string): string {
  if (typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  for (const el of Array.from(doc.body.querySelectorAll("style,script,head"))) el.remove();
  for (const br of Array.from(doc.body.querySelectorAll("br,p,div,li,tr"))) br.append("\n");
  return (doc.body.textContent ?? "").replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

/** Wraps plain text as HTML paragraphs (escaped), for rendering text/plain bodies. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space:pre-wrap">${esc}</div>`;
}

/**
 * The height of the mail's own content. documentElement.scrollHeight is never smaller than the iframe's current
 * height, so a short message in a tall frame would never shrink. The body's content height can.
 */
export function contentHeight(doc: Document): number {
  const body = doc.body;
  if (body && body.scrollHeight > 0) {
    const cs = doc.defaultView?.getComputedStyle(body);
    const margins = (Number.parseFloat(cs?.marginTop ?? "0") || 0) + (Number.parseFloat(cs?.marginBottom ?? "0") || 0);
    return Math.ceil(body.scrollHeight + margins);
  }
  return Math.ceil(doc.documentElement.scrollHeight);
}

/**
 * Keeps `onHeight` current with the document height. Reads from the parent: the frame is
 * same-origin and script-free. Returns a dispose function.
 */
export function observeFrameHeight(frame: HTMLIFrameElement, onHeight: (px: number) => void): () => void {
  let ro: ResizeObserver | null = null;
  let last = -1;

  const measure = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const h = contentHeight(doc);
    if (h !== last) {
      last = h;
      onHeight(h);
    }
  };

  const attach = () => {
    ro?.disconnect();
    const doc = frame.contentDocument;
    if (!doc) return;
    measure();
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(doc.documentElement);
      if (doc.body) ro.observe(doc.body);
    }
    // Images finishing their load change height without resizing the root in some engines.
    doc.addEventListener("load", measure, true);
  };

  frame.addEventListener("load", attach);
  if (frame.contentDocument?.readyState === "complete") attach();
  return () => {
    frame.removeEventListener("load", attach);
    ro?.disconnect();
  };
}

/** Intercepts link clicks inside the frame and routes them to `open` (system browser). */
export function interceptLinks(frame: HTMLIFrameElement, open: (url: string) => void): () => void {
  const doc = frame.contentDocument;
  if (!doc) return () => undefined;
  const onClick = (e: MouseEvent) => {
    const a = (e.target as Element | null)?.closest?.("a");
    const href = a?.getAttribute("href");
    if (!a || !href) return;
    e.preventDefault();
    if (/^(https?:|mailto:)/i.test(href)) open(href);
  };
  doc.addEventListener("click", onClick);
  return () => doc.removeEventListener("click", onClick);
}
