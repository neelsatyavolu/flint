/**
 * Hosts of known email tracking pixels. Matches the host and any subdomain.
 * Only used for renderer requests when settings.inbox.blockTrackers is on;
 * core's sanitizer strips the same pixels from the HTML.
 */
export const TRACKER_HOSTS: readonly string[] = [
  "list-manage.com",
  "mandrillapp.com",
  "sendgrid.net",
  "mailtrack.io",
  "mailtrack.me",
  "yesware.com",
  "getnotify.com",
  "bananatag.com",
  "mailfoogae.appspot.com",
  "hubspotemail.net",
  "hs-analytics.net",
  "cmail19.com",
  "cmail20.com",
  "exacttarget.com",
  "convertkit-mail.com",
  "sparkpostmail.com",
  "customeriomail.com",
  "pixel.watch",
  "tracking.mailerlite.com",
  "open.mailgun.org",
  "t.sidekickopen.com",
];

export function hostMatchesList(host: string, list: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return list.some((entry) => h === entry || h.endsWith(`.${entry}`));
}

export function isTrackerHost(host: string): boolean {
  return hostMatchesList(host, TRACKER_HOSTS);
}
