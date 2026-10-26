import { adaptBody } from "./adaptHtml";
import { analyzeAdaptability, type Adaptability } from "./adaptability";

export { DARK } from "./color";
export type { Adaptability } from "./adaptability";

export type MailDarkResult = Adaptability & {
  /** The recolored HTML. Always produced, so the user can still choose dark for mail we would not adapt. */
  html: string;
};

/**
 * Recolors mail HTML for a dark reader: text lightens, light fills darken, links take the accent,
 * images are untouched. Pure string to string via DOMParser (no script runs, nothing loads).
 * Falls back to the input when there is no DOM.
 */
export function adaptMailForDark(html: string): MailDarkResult {
  if (typeof DOMParser === "undefined" || html.trim() === "") return { html, adaptable: true, reasons: [] };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const verdict = analyzeAdaptability(doc.body, html);
  adaptBody(doc.body);
  return { ...verdict, html: serializeBody(doc.body) };
}

/** Adapted mail kept per message, so reopening a thread or re-rendering a card does not reparse its HTML. */
const CACHE_LIMIT = 100;
const cache = new Map<string, MailDarkResult>();

/** FNV-1a over the HTML, plus its length, so an edited body (remote images loaded) gets a fresh entry. */
export function hashHtml(html: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    h ^= html.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}.${html.length}`;
}

/**
 * adaptMailForDark through a small LRU keyed by message id and an HTML hash. The result is shared between callers,
 * so treat it as read-only.
 */
export function adaptMailForDarkCached(messageId: number, html: string): MailDarkResult {
  const key = `${messageId}:${hashHtml(html)}`;
  const hit = cache.get(key);
  if (hit) {
    // Re-insert so the entry counts as most recently used.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const result = adaptMailForDark(html);
  cache.set(key, result);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return result;
}

/** For tests. */
export function clearMailDarkCache(): void {
  cache.clear();
}

/** Attributes the parser merged onto <body> (bgcolor, style, text) are re-applied on a wrapper, since only the innerHTML is used. */
function serializeBody(body: HTMLElement): string {
  const style = [body.getAttribute("style"), body.getAttribute("bgcolor") ? `background-color:${body.getAttribute("bgcolor")}` : "", body.getAttribute("text") ? `color:${body.getAttribute("text")}` : ""]
    .filter(Boolean)
    .join(";");
  const inner = body.innerHTML;
  return style ? `<div style="${style.replace(/"/g, "&quot;")}">${inner}</div>` : inner;
}
