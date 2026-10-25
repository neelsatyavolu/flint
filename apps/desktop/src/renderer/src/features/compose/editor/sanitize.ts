import DOMPurify from "dompurify";

const PASTE_TAGS = ["p", "br", "strong", "b", "em", "i", "u", "a", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "img", "h1", "h2", "h3", "div", "span"];

/** Pasted content keeps structure and links only: no styles, classes, ids, scripts or event handlers. */
export function sanitizePastedHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: PASTE_TAGS,
    ALLOWED_ATTR: ["href", "src", "alt"],
    ALLOW_DATA_ATTR: false,
  });
}

/** Signatures keep their layout (tables, inline styles, images) but lose anything executable. */
export function sanitizeSignatureHtml(html: string): string {
  return DOMPurify.sanitize(html, { FORBID_TAGS: ["style", "form", "iframe", "object", "embed", "link", "meta"], FORBID_ATTR: ["srcdoc"] });
}
