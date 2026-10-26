import type { RankedCode, WireCode } from "./protocol";

/** Second-level labels that act like a public suffix under a two-letter country TLD (co.uk, com.au, ...). */
const SLD_UNDER_CCTLD = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go", "gob", "ltd", "plc"]);

/** The registrable domain of a host ("www.kayak.com" -> "kayak.com", "a.b.example.co.uk" -> "example.co.uk"). Heuristic, no suffix list. */
export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h || h.includes(":") || /^\d+(\.\d+){3}$/.test(h)) return h;
  const labels = h.split(".");
  if (labels.length <= 2) return h;
  const tld = labels[labels.length - 1] ?? "";
  const sld = labels[labels.length - 2] ?? "";
  const take = tld.length === 2 && SLD_UNDER_CCTLD.has(sld) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Codes whose sender domain shares a registrable domain with one of the page hosts come first; each group is newest first. */
export function rankCodes(codes: readonly WireCode[], pageHosts: readonly string[]): RankedCode[] {
  const pages = new Set(pageHosts.filter(Boolean).map(registrableDomain));
  const ranked = codes.map((c) => ({ ...c, matchesSite: pages.has(registrableDomain(c.senderDomain)) }));
  return ranked.sort((a, b) => Number(b.matchesSite) - Number(a.matchesSite) || b.receivedAt - a.receivedAt);
}
