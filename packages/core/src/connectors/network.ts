import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

type ConnectorLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;

function publicIpv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number) as [number, number, number, number];
  return a !== 0 && a !== 10 && a !== 127 && a < 224 &&
    !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) &&
    !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254);
}

/** Reject non-public destinations, including IPv4 hidden inside an IPv6 mapped address. */
export function isPublicConnectorAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family !== 6 || address.includes("%")) return false;
  // URL canonicalization converts an IPv4 suffix to hex and normalizes expanded IPv6.
  const normalized = new URL(`https://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = normalized.split("::");
  const head = left ? left.split(":") : [];
  const tail = right ? right.split(":") : [];
  const words = (right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]).map((word) => parseInt(word, 16));
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return publicIpv4(`${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`);
  }
  if (words.slice(0, 7).every((word) => word === 0) && words[7]! <= 1) return false;
  const first = words[0]!;
  return (first & 0xfe00) !== 0xfc00 && (first & 0xffc0) !== 0xfe80 && (first & 0xff00) !== 0xff00;
}

/**
 * Check immediately before each request. Core accepts a standard injected fetch without a dispatcher
 * contract, so this is a resolve-then-check fallback: fetch resolves again, leaving a DNS-rebinding gap.
 */
export async function assertPublicConnectorUrl(
  value: string,
  lookupImpl: ConnectorLookup = (hostname) => lookup(hostname, { all: true }),
): Promise<void> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Connected app URLs must use HTTPS without credentials or fragments.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookupImpl(hostname);
  if (!addresses.length || addresses.some(({ address }) => !isPublicConnectorAddress(address))) {
    throw new Error("Connected app URLs must resolve only to public IP addresses.");
  }
}
