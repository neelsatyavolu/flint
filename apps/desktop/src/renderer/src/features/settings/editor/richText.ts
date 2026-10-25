import DOMPurify from "dompurify";

/** Only http(s), mailto and tel links are kept. A bare "example.com" becomes https. Returns null for anything else. */
export function normalizeLink(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return null;
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return /^[^\s/]+\.[^\s/]+/.test(v) ? `https://${v}` : null;
}

/** The visual editor drops markup it has no node for (tables, inline styles). Start in source mode when that would happen. */
export function needsSourceMode(html: string): boolean {
  return /<(table|style|font|center)\b|\sstyle\s*=/i.test(html);
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["style", "form", "input", "script", "iframe"] });
}

const DROPPED_STYLES = new Set(["font-family", "font-size", "font-size-adjust", "font-stretch", "line-height"]);

/** A style attribute without the typeface (family, size, line height). Bold, italic, color and layout stay. Mirrors the Spark importer. */
export function styleWithoutFonts(style: string): string {
  const kept: string[] = [];
  for (const decl of style.split(";")) {
    const at = decl.indexOf(":");
    if (at < 0) continue;
    const prop = decl.slice(0, at).trim().toLowerCase();
    const value = decl.slice(at + 1).trim();
    if (!prop || !value || DROPPED_STYLES.has(prop)) continue;
    if (prop === "font") {
      if (/\b(bold|bolder|[6-9]00)\b/i.test(value)) kept.push("font-weight:bold");
      if (/\b(italic|oblique)\b/i.test(value)) kept.push("font-style:italic");
      continue;
    }
    kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

/** True when the signature carries its own typeface or size, so "Use Flint's font" would change it. */
export function hasCustomFont(html: string): boolean {
  return /font-family|font-size|\bline-height|\bfont\s*:|<font\b[^>]*\b(face|size)\s*=/i.test(html);
}

/** Removes fonts a signature brings with it so it inherits the one Flint composes in. */
export function applyFlintFont(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.body.querySelectorAll("*").forEach((el) => {
    el.removeAttribute("face");
    if (el.tagName === "FONT") el.removeAttribute("size");
    const style = el.getAttribute("style");
    if (style === null) return;
    const next = styleWithoutFonts(style);
    if (next) el.setAttribute("style", next);
    else el.removeAttribute("style");
  });
  return doc.body.innerHTML;
}

export const MAX_IMAGE_BYTES = 1_500_000;

export type ImageResult = { ok: true; dataUrl: string } | { ok: false; message: string };

/** Reads an image file into a data URL so the signature does not depend on a remote host. */
export function readImageFile(file: File): Promise<ImageResult> {
  if (!file.type.startsWith("image/")) return Promise.resolve({ ok: false, message: "That file is not an image." });
  if (file.size > MAX_IMAGE_BYTES) return Promise.resolve({ ok: false, message: "That image is over 1.5 MB. Use a smaller one." });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? { ok: true, dataUrl: reader.result } : { ok: false, message: "Couldn't read that image." });
    reader.onerror = () => resolve({ ok: false, message: "Couldn't read that image." });
    reader.readAsDataURL(file);
  });
}
