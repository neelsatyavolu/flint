/** 43-byte transparent 1x1 GIF. */
const B64 = "R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

export const PIXEL_GIF: Uint8Array = Uint8Array.from(atob(B64), (c) => c.charCodeAt(0));

export const PIXEL_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "image/gif",
  "Content-Length": String(PIXEL_GIF.length),
  "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
};

export function pixelResponse(): Response {
  return new Response(PIXEL_GIF, { status: 200, headers: PIXEL_HEADERS });
}
