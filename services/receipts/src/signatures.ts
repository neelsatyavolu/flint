/** Signature tables used by classify.ts. Sources are listed in README.md. */

export const APPLE_ASNS: ReadonlySet<number> = new Set([714, 6185]);
/** Networks that host Apple's Private Relay egress (Akamai, Cloudflare, Fastly). Only meaningful together with an MPP-looking UA. */
export const RELAY_HOST_ASNS: ReadonlySet<number> = new Set([36183, 20940, 13335, 54113]);
export const GOOGLE_ASNS: ReadonlySet<number> = new Set([15169, 396982, 19527]);
export const MICROSOFT_ASNS: ReadonlySet<number> = new Set([8075, 8068, 8069]);

/** Orgs that only ever run security gateways: a hit from them is never a reader, at any time. */
export const SECURITY_ORG_RE =
  /proofpoint|mimecast|barracuda|ironport|cisco (?:email|systems ironport)|trend ?micro|sophos|fortinet|forcepoint|websense|symantec|broadcom|messagelabs|zscaler|mailguard|cloudmark|avanan|darktrace|vade ?secure|kaspersky|bitdefender|fireeye|trellix|mandiant|area ?1|appriver|opentext|retarus|hornetsecurity|spamhero/i;

/** Generic hosting networks: a reader never opens mail from these, except through a recognized proxy. */
export const HOSTING_ORG_RE =
  /amazon|aws|google cloud|google llc|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai-?(?:linode)?|vultr|oracle|alibaba|tencent|rackspace|leaseweb|cloudflare|fastly|choopa|contabo|scaleway|datacamp|m247|cogent|zenlayer/i;
export const GOOGLE_ORG_RE = /google/i;
export const MICROSOFT_ORG_RE = /microsoft/i;
export const APPLE_ORG_RE = /apple inc|icloud private relay/i;

export const SCANNER_UA_RE =
  /safelinks|microsoft-defender|defender|proofpoint|mimecast|barracuda|ironport|trendmicro|sophos|fortinet|forcepoint|symantec|zscaler|bitdefender|kaspersky|fireeye|trellix|avanan|cloudmark|urlscan|virustotal|google-safety|googlesecurity|google web preview|mailscanner|spamassassin|clamav|norton|mcafee/i;

export const BOT_UA_RE =
  /curl\/|wget\/|python|go-http-client|java\/|okhttp|axios|node-fetch|undici|libwww|httpclient|aiohttp|scrapy|headlesschrome|phantomjs|puppeteer|playwright|selenium|slackbot|discordbot|facebookexternalhit|facebot|telegrambot|whatsapp|twitterbot|linkedinbot|skypeuripreview|embedly|pinterest|redditbot|applebot|\b(?:bot|crawler|spider)\b/i;

export const OUTLOOK_UA_RE = /microsoft office|msoffice|ms-office|microsoft outlook|outlook-(?:ios|android|mobile)|outlook\//i;
export const GOOGLE_PROXY_UA_RE = /googleimageproxy/i;
export const YAHOO_PROXY_UA_RE = /yahoomailproxy/i;

/** Frozen, anachronistic UA used by machine fetchers (Chrome 42 / Edge 12). No person reads mail with Edge 12 in 2026. */
export const FROZEN_MACHINE_UA_RE = /chrome\/42\.0\.2311\.135.*edge\/12\.246/i;

/** Apple's MPP proxy sends a bare "Mozilla/5.0". */
export const BARE_MOZILLA_RE = /^mozilla\/5\.0$/i;

export const MAIL_APP_UAS: readonly (readonly [RegExp, string])[] = [
  [/thunderbird/i, "Thunderbird"],
  [/superhuman/i, "Superhuman"],
  [/\bspark\b/i, "Spark"],
  [/airmail/i, "Airmail"],
  [/mailspring/i, "Mailspring"],
  [/edison/i, "Edison Mail"],
  [/newton/i, "Newton"],
  [/\bhey\b/i, "HEY"],
  [/fastmail/i, "Fastmail"],
  [/samsung ?(?:email|mail)/i, "Samsung Email"],
  [/proton ?mail/i, "Proton Mail"],
];

export const SCANNER_WINDOW_SECONDS = 60;
export const DUPLICATE_WINDOW_SECONDS = 10;
export const FORWARD_GAP_SECONDS = 3600;
