const SNIFF: [string, number[]][] = [
  ["image/png", [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["image/webp", [0x52, 0x49, 0x46, 0x46]],
];

/** Only images are ever served here; anything else is sent as an opaque download type. */
export function sniffImageType(bytes: Uint8Array): string {
  for (const [type, magic] of SNIFF) if (magic.every((b, i) => bytes[i] === b)) return type;
  const head = Buffer.from(bytes.subarray(0, 256)).toString("utf8").trimStart();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) return "image/svg+xml";
  return "application/octet-stream";
}

/**
 * Returns the numeric attachment id for flint-attachment://<id>, or null for anything else.
 * The URL parser treats a numeric host as an IPv4 address, so flint-attachment://3 arrives
 * as flint-attachment://0.0.0.3/ and is converted back here.
 */
export function parseAttachmentUrl(url: string): number | null {
  const m = /^flint-attachment:\/\/([\d.]{1,15})\/?$/.exec(url);
  if (!m) return null;
  const host = m[1]!;
  let id: number;
  if (host.includes(".")) {
    const parts = host.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
    id = ((parts[0]! * 256 + parts[1]!) * 256 + parts[2]!) * 256 + parts[3]!;
  } else {
    id = Number(host);
  }
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

