/** Image validation for profile pictures. Only PNG and JPEG (and GIF/WebP from Gravatar) are accepted, judged by the bytes, never by a claimed type. */

export const MAX_AVATAR_BYTES = 1024 * 1024;

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export function sniffImage(bytes: Uint8Array): ImageMime | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Decodes a PNG or JPEG data URL up to MAX_AVATAR_BYTES. Returns null when it is anything else. */
export function parseImageDataUrl(value: string): Buffer | null {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!m || !m[2] || m[2].length > Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 4) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_AVATAR_BYTES) return null;
  const mime = sniffImage(bytes);
  return mime === "image/png" || mime === "image/jpeg" ? bytes : null;
}

export const toDataUrl = (bytes: Uint8Array, mime: ImageMime): string => `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
