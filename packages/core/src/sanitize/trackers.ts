/**
 * Known email tracking pixels. A rule with no `path` means the whole host only serves tracking
 * (any image from it is removed). A rule with a `path` is for hosts that also serve real content,
 * so only URLs that match are treated as pixels.
 */
export type TrackerRule = { host: string; path?: RegExp };

export const TRACKER_RULES: readonly TrackerRule[] = [
  // Dedicated tracking hosts
  { host: "mailtrack.io" },
  { host: "pixel.mailtrack.io" },
  { host: "mailsuite.com" },
  { host: "mailspring.com" },
  { host: "pixel.superhuman.com" },
  { host: "r.superhuman.com" },
  { host: "t.hubspotemail.net" },
  { host: "track.hubspot.com" },
  { host: "hubspotlinks.com", path: /\/(e2t|__ptq)/i },
  { host: "t.yesware.com" },
  { host: "yesware.com", path: /\/(trk|track|pixel)/i },
  { host: "mailstat.us" },
  { host: "t.streak.com" },
  { host: "mailfoogae.appspot.com" },
  { host: "track.mixmax.com" },
  { host: "mixmax.com", path: /\/(api\/track|track)/i },
  { host: "cirrusinsight.com" },
  { host: "bl-1.com" },
  { host: "bananatag.com" },
  { host: "bl.bananatag.com" },
  { host: "email.getnotify.com" },
  { host: "getnotify.com" },
  { host: "sendibt2.com" },
  { host: "sendibt3.com" },
  { host: "sendinblue.com", path: /\/(track|open)/i },
  { host: "brevo.com", path: /\/(track|open)/i },
  { host: "mandrillapp.com", path: /\/track\/open/i },
  { host: "mcsv.net", path: /\/track/i },
  { host: "list-manage.com", path: /\/track\/open/i },
  { host: "rs6.net", path: /\/(on|o)\.jsp/i },
  { host: "r20.rs6.net", path: /\/on\.jsp/i },
  { host: "constantcontact.com", path: /\/(o|on)\.jsp|\/track/i },
  { host: "salesloft.com", path: /\/(open|track|e\/o)/i },
  { host: "sdr.salesloft.com" },
  { host: "outreach.io", path: /\/(open|track|e\/o)/i },
  { host: "app.outreach.io", path: /\/(open|track)/i },
  { host: "apollo.io", path: /\/(open|track|e\/o)/i },
  { host: "lemlist.com", path: /\/api\/(opened|track)/i },
  { host: "app.lemlist.com", path: /\/api\/opened/i },
  { host: "intercom-mail.com", path: /\/(via\/)?(o|open|track)\b/i },
  { host: "intercom-clicks.com", path: /\/(o|open|track)\b/i },
  { host: "customeriomail.com", path: /\/e\/o\//i },
  { host: "customer.io", path: /\/e\/o\//i },
  { host: "sparkpostmail.com", path: /\/q\/|\/o\//i },
  { host: "sendgrid.net", path: /\/wf\/open/i },
  { host: "postmarkapp.com", path: /\/(open|track)/i },
  { host: "pstmrk.it", path: /\/open/i },
  { host: "mailgun.org", path: /\/(o|open)\//i },
  { host: "mgsend.net", path: /\/o\//i },
  { host: "klaviyomail.com", path: /\/(open|wf\/open)/i },
  { host: "klaviyo.com", path: /\/(open|wf\/open|trk)/i },
  { host: "exacttarget.com", path: /\/(o|open)/i },
  { host: "sfmc-content.com", path: /\/(open|o)\b/i },
  { host: "marketo.com", path: /\/trk|\/(open|track)/i },
  { host: "mktdns.com", path: /\/trk|\/(open|track)/i },
  { host: "pardot.com", path: /\/(r|o|track)\//i },
  { host: "eloqua.com", path: /\/(e\/)?(open|track)/i },
  { host: "emltrk.com" },
  { host: "ymlp.com", path: /\/(open|track)/i },
  { host: "mailchimp.com", path: /\/track\/open/i },
  { host: "campaign-archive.com", path: /\/track\/open/i },
  { host: "amazonses.com", path: /\/(o|open)\b|\/ses\/o/i },
  { host: "convertkit-mail.com", path: /\/open/i },
  { host: "ck.page", path: /\/open/i },
  { host: "flodesk.com", path: /\/(open|track)/i },
  { host: "substack.com", path: /\/(o|open)\b|\/track\/open/i },
  { host: "beehiiv.com", path: /\/(o|open|track)\b/i },
  { host: "ghost.io", path: /\/(o|open|track)\b/i },
  { host: "linkedin.com", path: /\/emimp\//i },
  { host: "facebookmail.com", path: /\/email\/pixel|\/track/i },
  { host: "email.mg.substack.com" },
  { host: "open.convertkit-mail2.com" },
  { host: "trk.klclick.com" },
  { host: "tracking.mail.reply.io" },
  { host: "reply.io", path: /\/(open|track)/i },
  { host: "woodpecker.co", path: /\/(open|track)/i },
  { host: "close.com", path: /\/(open|track)/i },
  { host: "pipedrive.com", path: /\/(open|track)/i },
  { host: "zoho.com", path: /\/(open|track)/i },
  { host: "zohocampaigns.com", path: /\/(open|track)/i },
  { host: "campaigner.com", path: /\/(open|track)/i },
  { host: "gmass.co", path: /\/(open|track)/i },
  { host: "cloudhq.net", path: /\/(open|track)/i },
  { host: "cloudhq-mkt3.net" },
  { host: "docsend.com", path: /\/(open|track)/i },
  { host: "boomerangapp.com", path: /\/(open|track)/i },
  { host: "contactmonkey.com" },
  { host: "polymail.io", path: /\/(open|track|v2\/track)/i },
];

/** Image URL paths that look like an open pixel on any host. Used only for tiny or hidden images. */
const GENERIC_PIXEL_PATH = /(?:^|[/._-])(?:open(?:ed)?|track(?:ing)?|pixel|beacon|trk|wf\/open|e\/o|o\.gif)(?:[/._?-]|$)/i;

export function hostOf(url: string): string | null {
  try {
    const normalized = url.startsWith("//") ? `https:${url}` : url;
    return new URL(normalized).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function hostMatches(host: string, rule: string): boolean {
  return host === rule || host.endsWith(`.${rule}`);
}

/** True when the URL points at the user's own receipts service (their pixel on mail they sent). */
export function isReceiptsUrl(url: string, receiptsHost: string | undefined): boolean {
  if (!receiptsHost) return false;
  const host = hostOf(url);
  const wanted = hostOf(receiptsHost.includes("://") ? receiptsHost : `https://${receiptsHost}`);
  return Boolean(host && wanted && hostMatches(host, wanted));
}

/** Known tracker host and path rules only (no size heuristics). */
export function matchesTrackerRule(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  let path = "";
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url);
    path = u.pathname + u.search;
  } catch {
    return false;
  }
  return TRACKER_RULES.some((r) => hostMatches(host, r.host) && (!r.path || r.path.test(path)));
}

/** Generic open-pixel heuristic for a tiny or hidden image. */
export function looksLikePixelUrl(url: string): boolean {
  try {
    const u = new URL(url.startsWith("//") ? `https:${url}` : url);
    return GENERIC_PIXEL_PATH.test(u.pathname);
  } catch {
    return false;
  }
}
