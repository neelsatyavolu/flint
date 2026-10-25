import { APPLE_RELAY_V4_24, APPLE_RELAY_V6_36 } from "./apple-ranges";

const v4 = new Set<number>(APPLE_RELAY_V4_24);
const v6 = new Set<string>(APPLE_RELAY_V6_36);

function expand6(ip: string): string | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (tail === undefined && h.length !== 8)) return null;
  const groups = [...h, ...Array<string>(fill).fill("0"), ...t];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0")).join("");
}

/** True when the IP is inside Apple's published iCloud Private Relay egress list (used by Mail Privacy Protection). */
export function isApplePrivateRelayIp(rawIp: string | null): boolean {
  if (!rawIp) return false;
  const ip = rawIp.trim().toLowerCase().replace(/^::ffff:/, "");
  if (ip.includes(":")) {
    const full = expand6(ip);
    return full !== null && v6.has(full.slice(0, 9));
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return v4.has(parts[0]! * 65536 + parts[1]! * 256 + parts[2]!);
}
