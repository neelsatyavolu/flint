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

/** Attributes the parser merged onto <body> (bgcolor, style, text) are re-applied on a wrapper, since only the innerHTML is used. */
function serializeBody(body: HTMLElement): string {
  const style = [body.getAttribute("style"), body.getAttribute("bgcolor") ? `background-color:${body.getAttribute("bgcolor")}` : "", body.getAttribute("text") ? `color:${body.getAttribute("text")}` : ""]
    .filter(Boolean)
    .join(";");
  const inner = body.innerHTML;
  return style ? `<div style="${style.replace(/"/g, "&quot;")}">${inner}</div>` : inner;
}
