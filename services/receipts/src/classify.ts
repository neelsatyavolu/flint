import type { EventKind } from "./protocol";
import {
  APPLE_ASNS, APPLE_ORG_RE, BARE_MOZILLA_RE, BOT_UA_RE, DUPLICATE_WINDOW_SECONDS, FORWARD_GAP_SECONDS, FROZEN_MACHINE_UA_RE,
  GOOGLE_ASNS, GOOGLE_ORG_RE, GOOGLE_PROXY_UA_RE, HOSTING_ORG_RE, MICROSOFT_ASNS, MICROSOFT_ORG_RE, OUTLOOK_UA_RE,
  RELAY_HOST_ASNS, SCANNER_UA_RE, SCANNER_WINDOW_SECONDS, SECURITY_ORG_RE, YAHOO_PROXY_UA_RE,
} from "./signatures";
import { clientFromUa, deviceFromUa } from "./ua";

export type Hit = {
  method: string;
  userAgent: string;
  asn: number | null;
  asOrganization: string | null;
  country: string | null;
  city: string | null;
  /** HMAC fingerprint of the request IP. */
  fingerprint: string;
  /** Whether the IP is inside Apple's published Private Relay egress list (computed by the caller from the raw IP). */
  appleEgress: boolean;
};

export type PreviousOpen = { at: number; fingerprint: string; client: string | null };

export type ClassifyContext = {
  /** Seconds between the message registration and this hit. */
  secondsSinceRegistered: number;
  /** Sender fingerprints for this install seen within the last 24h. */
  senderFingerprints: readonly string[];
  /** Earlier counted opens for this token, oldest first. */
  previousOpens: readonly PreviousOpen[];
  /** Current time in epoch ms. */
  now: number;
};

export type Classification = {
  kind: EventKind;
  client: string | null;
  device: string | null;
  /** False for proxies: the location is the proxy's, not the reader's. */
  locationReliable: boolean;
  possiblyForwarded: boolean;
  /** Short machine-readable reason, for tests and debugging. */
  reason: string;
};

const NONE = { client: null, device: null, locationReliable: false, possiblyForwarded: false } as const;

function result(kind: EventKind, reason: string, extra: Partial<Classification> = {}): Classification {
  return { kind, reason, ...NONE, ...extra };
}

export function classify(hit: Hit, ctx: ClassifyContext): Classification {
  const ua = hit.userAgent.trim();
  const asn = hit.asn;
  const org = hit.asOrganization ?? "";
  const early = ctx.secondsSinceRegistered < SCANNER_WINDOW_SECONDS;

  // 1. self
  if (ctx.senderFingerprints.includes(hit.fingerprint)) return result("self", "sender-fingerprint");

  // 2. prefetch: Apple Mail Privacy Protection
  const appleNet = hit.appleEgress || (asn !== null && APPLE_ASNS.has(asn)) || APPLE_ORG_RE.test(org);
  const relayHost = asn !== null && RELAY_HOST_ASNS.has(asn);
  if (appleNet) return result("prefetch", "apple-network", { client: "Apple Mail Privacy Protection" });
  // No real mail client sends a bare "Mozilla/5.0"; Apple's egress ranges change over time, so do not require a known network.
  if (BARE_MOZILLA_RE.test(ua)) return result("prefetch", relayHost ? "apple-ua-on-relay-host" : "bare-mozilla-ua", { client: "Apple Mail Privacy Protection" });

  // 3. scanner
  if (hit.method.toUpperCase() === "HEAD") return result("scanner", "head-request");
  if (SCANNER_UA_RE.test(ua)) return result("scanner", "scanner-ua");
  if (SECURITY_ORG_RE.test(org)) return result("scanner", "security-org");
  if (FROZEN_MACHINE_UA_RE.test(ua)) return result("scanner", "frozen-machine-ua");

  const googleNet = (asn !== null && GOOGLE_ASNS.has(asn)) || GOOGLE_ORG_RE.test(org);
  const gmailProxy = GOOGLE_PROXY_UA_RE.test(ua) && (asn === null || googleNet);
  const yahooProxy = YAHOO_PROXY_UA_RE.test(ua);
  const outlookClient = OUTLOOK_UA_RE.test(ua);
  const microsoftNet = (asn !== null && MICROSOFT_ASNS.has(asn)) || MICROSOFT_ORG_RE.test(org);
  const proxy = gmailProxy || yahooProxy;

  // Google network without the Gmail proxy marker: prefetch or content inspection, not a reader.
  if (googleNet && !gmailProxy) return result("scanner", "google-without-proxy-ua");
  // Spoofed proxy UA from elsewhere.
  if (GOOGLE_PROXY_UA_RE.test(ua) && !gmailProxy) return result("bot", "spoofed-gmail-proxy-ua");
  // Microsoft datacenter without an Outlook client: Safe Links / EOP detonation, at any delay (greylisting, quarantine release, serial sends).
  if (microsoftNet && !outlookClient) return result("scanner", "microsoft-without-outlook-ua");
  // Other hosting networks within the window.
  if (!proxy && !outlookClient && HOSTING_ORG_RE.test(org)) {
    return result(early ? "scanner" : "bot", early ? "hosting-early" : "hosting-late");
  }

  // 4. bot
  if (ua === "") return result("bot", "empty-ua");
  if (!proxy && !outlookClient && BOT_UA_RE.test(ua)) return result("bot", "bot-ua");

  // Client and device for a countable hit.
  let client: string | null;
  let device: string | null = null;
  if (gmailProxy) client = "Gmail";
  else if (yahooProxy) client = "Yahoo Mail";
  else if (microsoftNet && !outlookClient) client = "Outlook.com";
  else {
    client = clientFromUa(ua);
    device = deviceFromUa(ua);
  }

  // 5. duplicate: a repeat render shortly after a counted open
  const dup = ctx.previousOpens.some(
    (p) =>
      (ctx.now - p.at) / 1000 < DUPLICATE_WINDOW_SECONDS &&
      p.client === client &&
      (p.fingerprint === hit.fingerprint || proxy),
  );
  if (dup) return result("duplicate", "repeat-within-10s", { client, device });

  // 6. open
  const first = ctx.previousOpens[0];
  const possiblyForwarded =
    first !== undefined &&
    first.fingerprint !== hit.fingerprint &&
    first.client !== client &&
    (ctx.now - first.at) / 1000 > FORWARD_GAP_SECONDS;
  const locationReliable = !proxy;
  return result("open", proxy ? "proxy-open" : "direct-open", { client, device, locationReliable, possiblyForwarded });
}
