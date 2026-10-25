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
  /** Remote https images load only when true (data: and cid: always work). */
  allowRemoteImages: boolean;
  /** Plain text/AI prose follows the theme; HTML mail gets a white sheet. */
  colors?: { bg: string; fg: string; link: string };
  padding?: number;
};

const WHITE_SHEET = { bg: "#ffffff", fg: "#1a1a17", link: "#2f6fe0" };

export function buildCsp(allowRemoteImages: boolean): string {
  const img = allowRemoteImages ? "img-src data: cid: https:" : "img-src data: cid:";
  const font = allowRemoteImages ? "font-src https: data:" : "font-src data:";
  return `default-src 'none'; ${img}; ${font}; style-src 'unsafe-inline'; media-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`;
}

export function buildSrcdoc(opts: SrcdocOptions): string {
  const c = opts.colors ?? WHITE_SHEET;
  const pad = opts.padding ?? 16;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${buildCsp(opts.allowRemoteImages)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
html{background:${c.bg};color-scheme:light}
body{margin:0;padding:${pad}px;background:${c.bg};color:${c.fg};font:14.5px/1.5 "Geist Variable",ui-sans-serif,-apple-system,"Helvetica Neue",Arial,sans-serif;overflow-wrap:anywhere;word-break:normal;-webkit-font-smoothing:antialiased}
a{color:${c.link}}
img{max-width:100%;height:auto}
table{max-width:100%}
blockquote{margin:0 0 0 4px;padding-left:12px;border-left:2px solid rgba(128,128,128,.35);color:inherit;opacity:.85}
pre{white-space:pre-wrap}
</style></head><body>${opts.html}</body></html>`;
}

/** Wraps plain text as HTML paragraphs (escaped), for rendering text/plain bodies. */
export function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="white-space:pre-wrap">${esc}</div>`;
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
    const h = Math.ceil(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0));
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
