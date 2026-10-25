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
