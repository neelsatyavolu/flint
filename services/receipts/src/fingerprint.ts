const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", k, encoder.encode(data)));
}

/** IPv6 addresses rotate within a /64 (privacy extensions), so only the /64 is hashed. */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return mapped[1];
  if (!v.includes(":")) return v;
  const [head, tail] = v.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":");
}

/** HMAC-SHA256(salt, ip), truncated to 128 bits. The raw IP is never stored. */
export async function fingerprintIp(salt: string, ip: string): Promise<string> {
  return (await hmacHex(salt, `ip:${normalizeIp(ip)}`)).slice(0, 32);
}

/** Per-install re-hash: comparable within an install, not across installs, not reversible. */
export async function installFingerprint(salt: string, installId: string, fingerprint: string): Promise<string> {
  return (await hmacHex(salt, `install:${installId}:${fingerprint}`)).slice(0, 32);
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/** Constant-time string comparison (length is not secret here: both are hex digests). */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
