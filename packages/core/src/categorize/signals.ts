/** Header and address signals used by categorize(). Pure data and small predicates. */

export type Headers = Record<string, string>;

/** Local parts that mean a machine sent the mail, with no other evidence needed. */
export const STRONG_LOCAL = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|automated|notifications?|calendar[-_.]?notification|alerts?|updates?|mailer(?:-daemon)?|bounces?|receipts?|billing|invoices?|statements?|orders?|order[-_.]?update|shipment[-_.]?tracking|shipping|service|dse|auto[-_.]?confirm)([-_.+0-9].*)?$/;
/** Local parts that are often a real inbox, so they count only next to a bulk signal. */
export const WEAK_LOCAL = /^(accounts?|security|support|admissions?|apply|enroll(?:ment)?|registrar|info|team|hello|help|customer[-_.]?(?:care|service)|news|marketing|offers?)([-_.+0-9].*)?$/;

/** First subdomain label that marks an automated stream by itself. */
const STRONG_LABEL = /^(notifications?|notify|alerts?|mailer|bounces?|noreply|no-reply)$/;
/** Labels used by marketing platforms but also by real people at a university or company: need another signal. */
const WEAK_LABEL = /^(mail|email|e|em|msg|messages?|send|mg)$/;

export type DomainClass = "strong" | "weak" | "news" | "none";

export function subdomainClass(domain: string): DomainClass {
  const labels = domain.split(".");
  if (labels.length < 3) return "none";
  const first = labels[0]!;
  if (first === "news") return "news";
  if (STRONG_LABEL.test(first)) return "strong";
  if (WEAK_LABEL.test(first)) return "weak";
  return "none";
}

const domainRe = (names: string[]) => new RegExp(`(?:^|\\.)(?:${names.map((n) => n.replace(/\./g, "\\.")).join("|")})$`);

/** Services whose mail is always a notification stream, even when it carries list headers. */
export const ALWAYS_NOTIFY_DOMAIN = domainRe([
  "github.com", "gitlab.com", "bitbucket.org", "linear.app", "atlassian.net", "atlassian.com", "slack.com", "stripe.com", "docusign.net", "docusign.com",
  "calendar.google.com", "accounts.google.com", "notion.so", "figma.com", "asana.com", "sentry.io", "vercel.com", "cloudflare.com", "zoom.us",
]);
/** Services that send both receipts and marketing: notification only when the subject looks transactional or there are no list headers. */
export const MIXED_DOMAIN = domainRe(["amazon.com", "paypal.com", "uber.com", "linkedin.com", "venmo.com", "apple.com", "google.com", "airbnb.com", "doordash.com", "lyft.com"]);

export const TRANSACTIONAL_SUBJECT = /\b(receipt|your order|order (?:confirmation|#?\d)|invoice|payment (?:received|confirmation|failed|due)|password reset|reset your password|verification code|verify your|security alert|new sign-?in|sign-?in (?:attempt|alert)|login code|one-time|shipped|out for delivery|delivered|booking confirmation|reservation|invitation:|updated invitation|accepted:|declined:|statement is ready|your .{0,20}trip|payment to)\b/i;

/** Headers whose presence marks mail from a sending platform rather than a person's mail client. */
const ESP_HEADER = /^(feedback-id|x-ses-[\w-]+|x-mailgun-[\w-]+|x-sg-[\w-]+|x-mc-user|x-mandrill-[\w-]+|x-campaign(?:id)?|x-sfmc-[\w-]+|x-sfdc-[\w-]+|x-mailin-[\w-]+|x-hs-[\w-]+|x-hubspot-[\w-]+|x-report-abuse|x-csa-complaints)$/;
const ESP_MAILER = /(mailchimp|sendgrid|mandrill|mailgun|salesforce|exacttarget|marketing cloud|slate|technolutions|hubspot|constant ?contact|campaign ?monitor|klaviyo|braze|marketo|sparkpost|postmark|amazon ?ses|mailjet|sendinblue|brevo|iterable|customer\.io)/i;
const ESP_RETURN_PATH = /(amazonses\.com|sendgrid\.net|mailgun\.org|mcsv\.net|rsgsv\.net|mandrillapp\.com|exacttarget\.com|sparkpostmail\.com|mailjet\.com|hubspotemail\.net|sfmc-content\.com|salesforce\.com|technolutions\.com|slate\.)/i;

export function hasEspSignature(headers: Headers): boolean {
  for (const name of Object.keys(headers)) if (ESP_HEADER.test(name)) return true;
  if (ESP_MAILER.test(headers["x-mailer"] ?? "")) return true;
  return ESP_RETURN_PATH.test(headers["return-path"] ?? "");
}

export function hasTransactionalHeader(headers: Headers): boolean {
  const auto = (headers["auto-submitted"] ?? "").trim().toLowerCase();
  if (auto !== "" && auto !== "no") return true;
  return Object.keys(headers).some((n) => n === "x-github-reason" || n === "x-auto-response-suppress" || n.startsWith("x-linear-"));
}
