import { randomBytes } from "node:crypto";

/** 128-bit random id as 22 base64url characters. Used for both pixel tokens and message refs. */
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Normalizes the configured endpoint to an origin-style base URL, or null when it is not a usable https URL (http only for loopback, so the bearer secret never travels in cleartext). */
export function normalizeEndpoint(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function pixelUrlFor(endpoint: string, token: string): string {
  return `${endpoint}/i/${token}.gif`;
}

const escapeAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function pixelTag(pixelUrl: string): string {
  return `<img src="${escapeAttr(pixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0" />`;
}

/** Puts the pixel as the first element inside <body>, or in front of the markup when there is no body tag. */
export function injectPixel(html: string, pixelUrl: string): string {
  const tag = pixelTag(pixelUrl);
  const body = /<body\b[^>]*>/i.exec(html);
  if (!body) return tag + html;
  const end = body.index + body[0].length;
  return html.slice(0, end) + tag + html.slice(end);
}
