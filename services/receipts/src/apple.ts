import { APPLE_RELAY_V4_24, APPLE_RELAY_V6_36 } from "./apple-ranges";

/** Apple's published egress ranges in the compact form used for lookups: IPv4 /24 blocks and IPv6 /36 prefixes. */
export type AppleRanges = { v4: ReadonlySet<number>; v6: ReadonlySet<string> };

export const SNAPSHOT_RANGES: AppleRanges = { v4: new Set(APPLE_RELAY_V4_24), v6: new Set(APPLE_RELAY_V6_36) };

export function expand6(ip: string): string | null {
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
export function isApplePrivateRelayIp(rawIp: string | null, ranges: AppleRanges = SNAPSHOT_RANGES): boolean {
  if (!rawIp) return false;
  const ip = rawIp.trim().toLowerCase().replace(/^::ffff:/, "");
  if (ip.includes(":")) {
    const full = expand6(ip);
    return full !== null && ranges.v6.has(full.slice(0, 9));
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return ranges.v4.has(parts[0]! * 65536 + parts[1]! * 256 + parts[2]!);
}

/** Parses Apple's egress CSV (first column is a CIDR). Skips lines it does not understand. */
export function parseEgressCsv(csv: string): AppleRanges & { lines: number } {
  const v4 = new Set<number>();
  const v6 = new Set<string>();
  let lines = 0;
  for (const line of csv.split("\n")) {
    const cidr = line.split(",")[0]?.trim();
    if (!cidr) continue;
    const [ip, lenRaw] = cidr.split("/");
    const len = Number(lenRaw);
    if (!ip || !Number.isInteger(len)) continue;
    if (ip.includes(":")) {
      const full = expand6(ip.toLowerCase());
      if (!full || len < 36) continue; // a shorter prefix would not map onto one /36 key
      v6.add(full.slice(0, 9));
    } else {
      const p = ip.split(".").map(Number);
      if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255) || len < 24 || len > 32) continue;
      v4.add(p[0]! * 65536 + p[1]! * 256 + p[2]!);
    }
    lines++;
  }
  return { v4, v6, lines };
}
