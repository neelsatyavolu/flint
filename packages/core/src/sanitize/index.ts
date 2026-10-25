import sanitizeHtml from "sanitize-html";
import { cleanCss } from "./css";
import { htmlToText, snippetFrom } from "./htmlToText";
import { hostOf, isReceiptsUrl, looksLikePixelUrl, matchesTrackerRule } from "./trackers";

export { htmlToText, snippetFrom };
export { TRACKER_RULES, matchesTrackerRule, isReceiptsUrl } from "./trackers";

/** 1x1 transparent GIF that stands in for blocked remote images. */
export const PLACEHOLDER_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export type SanitizeOptions = {
  /** Load remote images. When false they become a transparent placeholder that keeps width and height. */
  allowRemoteImages: boolean;
  /** Host of the user's own receipts service. Anything pointing at it is removed. */
  receiptsHost?: string;
  /** Maps a Content-ID (without cid:) to a URL the display iframe can load, or null when unknown. */
  cidResolver?: (cid: string) => string | null;
  /** Remove known tracking pixels. Default true. */
  blockTrackers?: boolean;
};

export type SanitizeResult = {
  html: string;
  /** Known third-party tracking pixels were removed. */
  hasTrackers: boolean;
  /** The message has remote images that are blocked (or were loaded) that are not trackers. */
  hasRemoteImages: boolean;
};

const ALLOWED_TAGS = [
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite",
  "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main", "mark", "nav", "ol",
  "p", "pre", "q", "s", "samp", "section", "small", "span", "strike", "strong", "style", "sub", "summary", "sup",
  "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr",
];

const NON_TEXT_TAGS = ["script", "textarea", "option", "noscript", "title", "template", "iframe", "noembed", "noframes", "xmp", "object", "embed"];

const GLOBAL_ATTRS = ["class", "id", "style", "dir", "lang", "title", "align", "valign", "width", "height", "bgcolor", "color", "border", "role", "data-flint-drop"];
const TABLE_ATTRS = ["cellpadding", "cellspacing", "colspan", "rowspan", "background", "nowrap", "scope", "span"];

const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif|x-icon|vnd\.microsoft\.icon)[;,]/i;
const SAFE_HREF = /^(?:https?:|mailto:|tel:|#)/i;

function parseSize(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v);
  return m ? Number(m[1]) : null;
}

function styleSize(style: string, prop: "width" | "height"): number | null {
  const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)\\s*(?:px)?\\s*(?:!important)?\\s*(?:;|$)`, "i").exec(style);
  return m ? Number(m[1]) : null;
}

function isTinyOrHidden(attribs: Record<string, string>): boolean {
  const style = (attribs["style"] ?? "").toLowerCase();
  const w = parseSize(attribs["width"]) ?? styleSize(style, "width");
  const h = parseSize(attribs["height"]) ?? styleSize(style, "height");
  if ((w !== null && w <= 1) || (h !== null && h <= 1)) return true;
  return /display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$)|max-height\s*:\s*0|font-size\s*:\s*0/.test(style);
}

function isRemote(src: string): boolean {
  return /^(?:https?:)?\/\//i.test(src.trim());
}

/**
 * Makes mail HTML safe for a sandboxed iframe. Output is a body fragment, not a document.
 * Scripts, event handlers, forms, frames, objects, meta refresh, base tags, javascript: and non-image data: URLs
 * and external stylesheets are removed. Inline styles and style blocks stay.
 */
export function sanitizeForDisplay(html: string, opts: SanitizeOptions): SanitizeResult {
  let hasTrackers = false;
  let hasRemoteImages = false;
  const blockTrackers = opts.blockTrackers !== false;

  const cssFor = (css: string): string => {
    const r = cleanCss(css, { allowRemote: opts.allowRemoteImages });
    if (r.remoteUrls.length) hasRemoteImages = true;
    return r.css;
  };

  const transformImg = (tagName: string, attribs: Record<string, string>) => {
    const out = { ...attribs };
    const src = (out["src"] ?? "").trim();
    const drop = () => ({ tagName, attribs: { ...out, "data-flint-drop": "1" } });
    const placeholder = () => ({ tagName, attribs: { ...out, src: PLACEHOLDER_GIF } });
    delete out["srcset"];
    delete out["background"];
    if (!src) return drop();
    if (/^cid:/i.test(src)) {
      const resolved = opts.cidResolver?.(src.slice(4).replace(/^<|>$/g, "")) ?? null;
      if (resolved) return { tagName, attribs: { ...out, src: resolved } };
      return placeholder();
    }
    if (/^data:/i.test(src)) return DATA_IMAGE.test(src) ? { tagName, attribs: out } : drop();
    if (!isRemote(src)) return drop();
    const full = src.startsWith("//") ? `https:${src}` : src;
    if (isReceiptsUrl(full, opts.receiptsHost)) return drop();
    if (blockTrackers && (matchesTrackerRule(full) || (isTinyOrHidden(out) && looksLikePixelUrl(full)))) {
      hasTrackers = true;
      return drop();
    }
    if (!hostOf(full)) return drop();
    hasRemoteImages = true;
    if (!opts.allowRemoteImages) return placeholder();
    return { tagName, attribs: { ...out, src: full } };
  };

  const transformAll = (tagName: string, attribs: Record<string, string>) => {
    const out = { ...attribs };
    if (out["style"] !== undefined) out["style"] = cssFor(out["style"]);
    if (out["background"] !== undefined) {
      const bg = out["background"].trim();
      if (isRemote(bg)) {
        hasRemoteImages = true;
        if (!opts.allowRemoteImages || isReceiptsUrl(bg, opts.receiptsHost) || (blockTrackers && matchesTrackerRule(bg))) delete out["background"];
      } else delete out["background"];
    }
    return { tagName, attribs: out };
  };

  const clean = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    nonTextTags: NON_TEXT_TAGS,
    allowVulnerableTags: true,
    disallowedTagsMode: "discard",
    allowedAttributes: {
      "*": GLOBAL_ATTRS,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "data-flint-drop"],
      table: TABLE_ATTRS, td: TABLE_ATTRS, th: TABLE_ATTRS, tr: TABLE_ATTRS, tbody: TABLE_ATTRS, thead: TABLE_ATTRS, tfoot: TABLE_ATTRS, col: TABLE_ATTRS, colgroup: TABLE_ATTRS,
      font: ["face", "size"],
      ol: ["start", "type"], li: ["value"],
      time: ["datetime"], q: ["cite"], blockquote: ["cite"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid", "flint-attachment"] },
    allowProtocolRelative: true,
    transformTags: {
      "*": transformAll,
      body: (_t, attribs) => transformAll("div", attribs),
      img: (tagName, attribs) => transformImg(tagName, transformAll(tagName, attribs).attribs),
      a: (tagName, attribs) => {
        const href = (attribs["href"] ?? "").trim();
        const next: Record<string, string> = { ...attribs };
        if (href && !SAFE_HREF.test(href.replace(/[\u0000- ]/g, ""))) delete next["href"];
        const out = transformAll(tagName, next);
        if (out.attribs["href"] && !out.attribs["href"].startsWith("#")) {
          out.attribs["target"] = "_blank";
          out.attribs["rel"] = "noopener noreferrer";
        } else {
          delete out.attribs["target"];
          delete out.attribs["rel"];
        }
        return out;
      },
    },
    textFilter: (text, tagName) => (tagName === "style" ? cssFor(text) : text),
    exclusiveFilter: (frame) => frame.attribs["data-flint-drop"] === "1",
  });

  return { html: clean, hasTrackers, hasRemoteImages };
}
