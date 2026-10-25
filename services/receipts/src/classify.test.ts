import { describe, expect, it } from "vitest";
import { classify, type ClassifyContext, type Hit } from "./classify";

const NOW = 1_800_000_000_000;
const baseHit: Hit = {
  method: "GET", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  asn: 7922, asOrganization: "Comcast Cable Communications, LLC", country: "US", city: "Seattle", fingerprint: "fp-reader", appleEgress: false,
};
const baseCtx: ClassifyContext = { secondsSinceRegistered: 3600, senderFingerprints: [], previousOpens: [], now: NOW };
const run = (h: Partial<Hit>, c: Partial<ClassifyContext> = {}) => classify({ ...baseHit, ...h }, { ...baseCtx, ...c });

const GMAIL_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const YAHOO_UA = "YahooMailProxy; https://help.yahoo.com/kb/yahoo-mail-proxy-SLN28749.html";
const OUTLOOK_UA = "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17328; Pro)";
const APPLE_MAIL_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const IOS_MAIL_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

describe("classify: table", () => {
  const cases: [string, Partial<Hit>, Partial<ClassifyContext>, string, string | null][] = [
    ["self fingerprint", { fingerprint: "me" }, { senderFingerprints: ["me"] }, "self", null],
    ["self beats prefetch", { fingerprint: "me", appleEgress: true }, { senderFingerprints: ["me"] }, "self", null],
    ["Apple egress list", { appleEgress: true, userAgent: "Mozilla/5.0", asn: 36183, asOrganization: "Akamai" }, {}, "prefetch", "Apple Mail Privacy Protection"],
    ["Apple ASN 714", { asn: 714, asOrganization: "Apple Inc.", userAgent: "Mozilla/5.0" }, {}, "prefetch", "Apple Mail Privacy Protection"],
    ["Apple ASN 6185", { asn: 6185, asOrganization: "Apple Inc." }, {}, "prefetch", "Apple Mail Privacy Protection"],
    ["bare Mozilla on Cloudflare relay host", { asn: 13335, asOrganization: "Cloudflare, Inc.", userAgent: "Mozilla/5.0" }, {}, "prefetch", "Apple Mail Privacy Protection"],
    ["bare Mozilla on Fastly", { asn: 54113, asOrganization: "Fastly", userAgent: "Mozilla/5.0" }, {}, "prefetch", "Apple Mail Privacy Protection"],
    ["Gmail proxy open", { userAgent: GMAIL_UA, asn: 15169, asOrganization: "Google LLC" }, {}, "open", "Gmail"],
    ["Gmail proxy, early, still open", { userAgent: GMAIL_UA, asn: 15169, asOrganization: "Google LLC" }, { secondsSinceRegistered: 5 }, "open", "Gmail"],
    ["Gmail proxy without cf data", { userAgent: GMAIL_UA, asn: null, asOrganization: null }, {}, "open", "Gmail"],
    ["Google without proxy UA", { asn: 15169, asOrganization: "Google LLC" }, {}, "scanner", null],
    ["spoofed Gmail proxy UA from residential", { userAgent: GMAIL_UA }, {}, "bot", null],
    ["Yahoo proxy", { userAgent: YAHOO_UA, asn: 26101, asOrganization: "Yahoo" }, {}, "open", "Yahoo Mail"],
    ["Outlook desktop on Microsoft ASN", { userAgent: OUTLOOK_UA, asn: 8075, asOrganization: "Microsoft Corporation" }, { secondsSinceRegistered: 10 }, "open", "Outlook"],
    ["Outlook desktop residential", { userAgent: OUTLOOK_UA }, {}, "open", "Outlook"],
    ["Outlook.com web proxy after window", { userAgent: "Mozilla/5.0", asn: 8075, asOrganization: "Microsoft Corporation" }, { secondsSinceRegistered: 600 }, "open", "Outlook.com"],
    ["Microsoft 8075 no Outlook UA within 60s", { asn: 8075, asOrganization: "Microsoft Corporation" }, { secondsSinceRegistered: 20 }, "scanner", null],
    ["Thunderbird", { userAgent: "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Thunderbird/128.2.0" }, {}, "open", "Thunderbird"],
    ["Apple Mail macOS without MPP", { userAgent: APPLE_MAIL_UA }, {}, "open", "Apple Mail"],
    ["iOS Mail without MPP", { userAgent: IOS_MAIL_UA }, {}, "open", "Apple Mail"],
    ["Superhuman", { userAgent: "Superhuman/1.0 Mozilla/5.0 (Macintosh)" }, {}, "open", "Superhuman"],
    ["Spark", { userAgent: "Mozilla/5.0 (Macintosh) Spark/3.4" }, {}, "open", "Spark"],
    ["plain browser", {}, {}, "open", "Web browser"],
    ["unknown client", { userAgent: "WeirdMailer 1.0" }, {}, "open", null],
    ["Proofpoint org", { asOrganization: "Proofpoint, Inc.", asn: 22843 }, { secondsSinceRegistered: 5000 }, "scanner", null],
    ["Mimecast org", { asOrganization: "Mimecast Services Limited", asn: 30031 }, {}, "scanner", null],
    ["Barracuda org", { asOrganization: "Barracuda Networks, Inc.", asn: 14560 }, {}, "scanner", null],
    ["Cisco IronPort org", { asOrganization: "Cisco IronPort Systems LLC" }, {}, "scanner", null],
    ["Trend Micro org", { asOrganization: "Trend Micro Incorporated" }, {}, "scanner", null],
    ["Zscaler org", { asOrganization: "Zscaler, Inc." }, {}, "scanner", null],
    ["Symantec org", { asOrganization: "Symantec Corporation" }, {}, "scanner", null],
    ["scanner UA SafeLinks", { userAgent: "Mozilla/5.0 SafeLinks" }, {}, "scanner", null],
    ["frozen Chrome 42 Edge 12 UA", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246" }, {}, "scanner", null],
    ["AWS within 60s", { asn: 16509, asOrganization: "Amazon.com, Inc." }, { secondsSinceRegistered: 12 }, "scanner", null],
    ["AWS after 60s", { asn: 16509, asOrganization: "Amazon.com, Inc." }, { secondsSinceRegistered: 900 }, "bot", null],
    ["Azure within 60s browser UA", { asn: 8075, asOrganization: "Microsoft Azure" }, { secondsSinceRegistered: 30 }, "scanner", null],
    ["DigitalOcean within 60s", { asn: 14061, asOrganization: "DigitalOcean, LLC" }, { secondsSinceRegistered: 1 }, "scanner", null],
    ["HEAD request", { method: "HEAD" }, {}, "scanner", null],
    ["HEAD request lower case", { method: "head" }, {}, "scanner", null],
    ["empty UA", { userAgent: "" }, {}, "bot", null],
    ["curl", { userAgent: "curl/8.4.0" }, {}, "bot", null],
    ["wget", { userAgent: "Wget/1.21" }, {}, "bot", null],
    ["python requests", { userAgent: "python-requests/2.31" }, {}, "bot", null],
    ["Go http client", { userAgent: "Go-http-client/2.0" }, {}, "bot", null],
    ["Java", { userAgent: "Java/17.0.1" }, {}, "bot", null],
    ["okhttp", { userAgent: "okhttp/4.12.0" }, {}, "bot", null],
    ["axios", { userAgent: "axios/1.6.0" }, {}, "bot", null],
    ["node-fetch", { userAgent: "node-fetch/1.0" }, {}, "bot", null],
    ["headless chrome", { userAgent: "Mozilla/5.0 HeadlessChrome/120.0 Safari/537.36" }, {}, "bot", null],
    ["Slackbot", { userAgent: "Slackbot-LinkExpanding 1.0" }, {}, "bot", null],
    ["Discordbot", { userAgent: "Mozilla/5.0 (compatible; Discordbot/2.0)" }, {}, "bot", null],
    ["facebookexternalhit", { userAgent: "facebookexternalhit/1.1" }, {}, "bot", null],
    ["TelegramBot", { userAgent: "TelegramBot (like TwitterBot)" }, {}, "bot", null],
    ["WhatsApp", { userAgent: "WhatsApp/2.23" }, {}, "bot", null],
    ["Twitterbot", { userAgent: "Twitterbot/1.0" }, {}, "bot", null],
    ["LinkedInBot", { userAgent: "LinkedInBot/1.0" }, {}, "bot", null],
  ];
  it.each(cases)("%s", (_name, hit, ctx, kind, client) => {
    const r = run(hit, ctx);
    expect(r.kind).toBe(kind);
    if (client !== null) expect(r.client).toBe(client);
  });
});

describe("classify: details", () => {
  it("devices", () => {
    expect(run({ userAgent: IOS_MAIL_UA }).device).toBe("iPhone");
    expect(run({ userAgent: APPLE_MAIL_UA }).device).toBe("Mac");
    expect(run({}).device).toBe("Windows");
    expect(run({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36" }).device).toBe("Android");
    expect(run({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5) AppleWebKit/605 Mobile/15E148" }).device).toBe("iPad");
    expect(run({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/120" }).device).toBe("Linux");
  });
  it("proxy opens have no device and no reliable location", () => {
    const r = run({ userAgent: GMAIL_UA, asn: 15169, asOrganization: "Google LLC" });
    expect(r.device).toBeNull();
    expect(r.locationReliable).toBe(false);
    expect(run({}).locationReliable).toBe(true);
  });
  it("duplicate: same fingerprint and client within 10s", () => {
    const prev = [{ at: NOW - 4000, fingerprint: "fp-reader", client: "Web browser" }];
    expect(run({}, { previousOpens: prev }).kind).toBe("duplicate");
  });
  it("not duplicate after 10s", () => {
    const prev = [{ at: NOW - 11_000, fingerprint: "fp-reader", client: "Web browser" }];
    expect(run({}, { previousOpens: prev }).kind).toBe("open");
  });
  it("not duplicate for a different fingerprint on a direct client", () => {
    const prev = [{ at: NOW - 2000, fingerprint: "other", client: "Web browser" }];
    expect(run({}, { previousOpens: prev }).kind).toBe("open");
  });
  it("proxy duplicates match across proxy IPs", () => {
    const prev = [{ at: NOW - 2000, fingerprint: "g1", client: "Gmail" }];
    expect(run({ userAgent: GMAIL_UA, asn: 15169, asOrganization: "Google LLC", fingerprint: "g2" }, { previousOpens: prev }).kind).toBe("duplicate");
  });
  it("possiblyForwarded: different fingerprint and client, over 1h later", () => {
    const prev = [{ at: NOW - 2 * 3600_000, fingerprint: "g1", client: "Gmail" }];
    const r = run({}, { previousOpens: prev });
    expect(r.kind).toBe("open");
    expect(r.possiblyForwarded).toBe(true);
  });
  it("not possiblyForwarded within 1h, same client, or same fingerprint", () => {
    expect(run({}, { previousOpens: [{ at: NOW - 1800_000, fingerprint: "g1", client: "Gmail" }] }).possiblyForwarded).toBe(false);
    expect(run({}, { previousOpens: [{ at: NOW - 7200_000, fingerprint: "g1", client: "Web browser" }] }).possiblyForwarded).toBe(false);
    expect(run({}, { previousOpens: [{ at: NOW - 7200_000, fingerprint: "fp-reader", client: "Gmail" }] }).possiblyForwarded).toBe(false);
  });
  it("first open is never possiblyForwarded", () => {
    expect(run({}).possiblyForwarded).toBe(false);
  });
});
