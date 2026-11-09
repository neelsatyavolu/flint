import { htmlToText } from "../sanitize/htmlToText";

/**
 * Finds package tracking and flight numbers in one message. Pure: no I/O, no clock. Precision over recall: when unsure,
 * nothing. Every value comes with the line it was read from, verbatim but trimmed ("Subject: …" and "From: …" for headers).
 *
 * A package needs a tracking number behind a cue ("Tracking ID", "tracking number:", "Waybill Number:", or a cue alone on
 * its line with the number on the next), or a carrier named in a subject that is about an order or a delivery. In
 * shipping mail, a number in a format only one carrier uses (UPS 1Z with its check digit, Amazon TBA, OnTrac C/D with
 * its check digit, LaserShip 1LS, DHL eCommerce GM) counts without a cue. Bare 10-14 digit numbers never do: they are
 * phone, order and ticket numbers as often as tracking numbers. Jitsu (formerly AxleHire) has no known format, so only
 * its sender or a link names it.
 *
 * A flight needs a line holding only a flight number ("UA 2090") from an airline the mail names. Carriers and airlines
 * are added together with a fixture (see __fixtures__; some are synthetic until real mail arrives).
 */
export type TrackingInput = {
  subject: string;
  text: string | null;
  html: string | null;
  fromName: string | null;
  fromAddress: string;
};

export type Quote = { value: string; line: string };

export type Tracked =
  | { kind: "package"; carrier: Quote | null; tracking: Quote | null }
  | { kind: "flight"; airline: Quote; flight: Quote };

/** Order matters: the first match wins, so "DHL eCommerce" comes before "DHL". `domain: null` never names the carrier by sender. */
const CARRIERS: { name: string; text: RegExp; domain: RegExp | null }[] = [
  { name: "FedEx", text: /\bfedex\b/i, domain: /(?:^|\.)fedex\.com$/i },
  { name: "USPS", text: /\bUSPS\b/, domain: /(?:^|\.)usps\.com$/i },
  { name: "UniUni", text: /\buniuni\b/i, domain: /(?:^|\.)uniuni\.com$/i },
  { name: "UPS", text: /\bUPS\b/, domain: /(?:^|\.)ups\.com$/i },
  { name: "DHL eCommerce", text: /\bDHL\s*eCommerce\b/i, domain: /(?:^|\.)dhl(?:ecommerce|ecs)\.com$/i },
  { name: "DHL", text: /\bDHL\b/, domain: /(?:^|\.)dhl\.(?:com|de)$/i },
  { name: "OnTrac", text: /\bOnTrac\b/i, domain: /(?:^|\.)ontrac\.com$/i },
  { name: "LaserShip", text: /\bLaserShip\b/i, domain: /(?:^|\.)lasership\.com$/i },
  { name: "Jitsu", text: /\b(?:jitsu|axlehire)\b|\bgojitsu\.com\b/i, domain: /(?:^|\.)(?:gojitsu|axlehire)\.com$/i },
  // Amazon sends mail for every carrier, so only Amazon's own delivery service counts, never the sender.
  { name: "Amazon", text: /\bAmazon\s+(?:Logistics|Shipping)\b|\bShipped\s+(?:with|by)\s+Amazon\b/i, domain: null },
];

/** Every carrier name detectTracking can return. */
export const CARRIER_NAMES: readonly string[] = CARRIERS.map((c) => c.name);

/**
 * Whether a message's headers alone make it worth downloading the body to look for a package: a shipping subject, or
 * mail from a carrier or from Amazon. Mail that fails this is still checked when its body is already on this computer.
 */
export function mayCarryTracking(subject: string, fromAddress: string): boolean {
  const domain = fromAddress.split("@")[1] ?? "";
  return SHIPPING_SUBJECT.test(subject) || /\btrack/i.test(subject) || /(?:^|\.)amazon\.com$/i.test(domain) ||
    CARRIERS.some((c) => c.domain?.test(domain));
}

const AIRLINES: Record<string, string> = { UA: "United Airlines", AS: "Alaska Airlines" };

/**
 * A tracking number is 10-34 letters and digits right after the cue, with at least 8 digits unless its format names a
 * carrier (LaserShip 1LSCX… has few digits).
 */
const CUE = String.raw`(?:tracking\s*(?:number|id|no\.?|#)|waybill(?:\s*(?:number|no\.?|#))?)`;
const TRACKING_CUE = new RegExp(String.raw`\b${CUE}\s*(?:is\s+)?:?\s*([A-Z0-9]{10,34})\b`, "i");
const CUE_ALONE = new RegExp(String.raw`^${CUE}\s*:?$`, "i");
const TOKEN_ALONE = /^([A-Z0-9]{10,34})(?:\s|$)/i;
const SHIPPING_SUBJECT = /\b(?:order|package|shipment|shipped|deliver(?:y|ed)?|on the way|arriving)\b/i;
/** The whole line is a flight number, after any "> " quote markers of a forward. */
const FLIGHT_LINE = /^[>\s]*([A-Z0-9]{2}) ?(\d{1,4})$/;

export function detectTracking(input: TrackingInput): Tracked[] {
  const body = input.text?.trim() ? input.text : htmlToText((input.html ?? "").slice(0, 200_000));
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const subjectLine = `Subject: ${input.subject}`;
  const fromLine = input.fromName ? `From: ${input.fromName} <${input.fromAddress}>` : `From: ${input.fromAddress}`;
  const mail = { subject: input.subject, subjectLine, fromLine, fromAddress: input.fromAddress, lines };
  const pkg = detectPackage(mail);
  return [...(pkg ? [pkg] : []), ...detectFlights(mail)];
}

type Mail = { subject: string; subjectLine: string; fromLine: string; fromAddress: string; lines: string[] };

function detectPackage(mail: Mail): Tracked | null {
  const shippingMail = SHIPPING_SUBJECT.test(mail.subject) || carrierOfSender(mail) !== null;
  const tracking = findTracking(mail.lines) ?? (shippingMail ? findStrongNumber(mail.lines) : null);
  if (tracking) {
    const carrier = carrierNamedIn(tracking.line) ?? carrierOfNumber(tracking) ?? carrierOfSender(mail) ?? firstCarrierLine([mail.subjectLine, ...mail.lines]);
    return { kind: "package", carrier, tracking };
  }
  if (!SHIPPING_SUBJECT.test(mail.subject)) return null;
  const carrier = carrierNamedIn(mail.subjectLine);
  return carrier ? { kind: "package", carrier, tracking: null } : null;
}

function findTracking(lines: string[]): Quote | null {
  for (const [i, line] of lines.entries()) {
    const token = TRACKING_CUE.exec(line)?.[1];
    if (token && plausibleNumber(token)) return { value: token.toUpperCase(), line };
    const next = lines[i + 1];
    const below = next !== undefined && CUE_ALONE.test(line) ? TOKEN_ALONE.exec(next)?.[1] : undefined;
    if (below && plausibleNumber(below)) return { value: below.toUpperCase(), line: next! };
  }
  return null;
}

function plausibleNumber(token: string): boolean {
  return (token.match(/\d/g)?.length ?? 0) >= 8 || carrierForNumber(token.toUpperCase()) !== null;
}

/** A number with no cue, only in a format that one carrier owns. Upper case only, as carriers print them. */
function findStrongNumber(lines: string[]): Quote | null {
  for (const line of lines) {
    for (const [token] of line.matchAll(/\b[A-Z0-9]{10,34}\b/g)) {
      if (carrierForNumber(token) !== null) return { value: token, line };
    }
  }
  return null;
}

function carrierOfNumber(tracking: Quote): Quote | null {
  const name = carrierForNumber(tracking.value);
  return name ? { value: name, line: tracking.line } : null;
}

/**
 * The carrier a number's format belongs to, or null when the format is shared or unknown. Rules and check digits from
 * jkeen/tracking_number_data (see porchlight docs/research/number-formats.md).
 */
export function carrierForNumber(n: string): string | null {
  if (/^1Z[0-9A-Z]{15}\d$/.test(n)) return mod10(n.slice(2, 17), 1, 2) === Number(n[17]) ? "UPS" : null;
  if (/^TB[ACM]\d{12}$/.test(n)) return "Amazon";
  const ontrac = /^([CD])(\d{13})(\d)$/.exec(n);
  if (ontrac) return mod10(`${ontrac[1] === "C" ? 4 : 5}${ontrac[2]}`, 1, 2) === Number(ontrac[3]) ? "OnTrac" : null;
  if (/^1LS(?:7[12](?:\d{10}|\d{2}01[1-4]\d{6})|CX[0-9A-Z]{10})$/.test(n)) return "LaserShip";
  if (/^GM\d{14,22}$/.test(n)) return "DHL eCommerce";
  return null;
}

/** jkeen "mod10": weights alternate from the left; letters map to (ASCII - 3) mod 10 (UPS: A=2 … H=9, I=0). */
function mod10(seq: string, evenWeight: number, oddWeight: number): number {
  let total = 0;
  for (const [i, c] of [...seq].entries()) {
    const value = /\d/.test(c) ? Number(c) : (c.charCodeAt(0) - 3) % 10;
    total += value * (i % 2 === 0 ? evenWeight : oddWeight);
  }
  return (10 - (total % 10)) % 10;
}

function carrierNamedIn(line: string): Quote | null {
  const carrier = CARRIERS.find((c) => c.text.test(line));
  return carrier ? { value: carrier.name, line } : null;
}

function carrierOfSender(mail: Mail): Quote | null {
  const domain = mail.fromAddress.split("@")[1] ?? "";
  const carrier = CARRIERS.find((c) => c.domain?.test(domain));
  return carrier ? { value: carrier.name, line: mail.fromLine } : null;
}

function firstCarrierLine(lines: string[]): Quote | null {
  for (const line of lines) {
    const carrier = carrierNamedIn(line);
    if (carrier) return carrier;
  }
  return null;
}

function detectFlights(mail: Mail): Tracked[] {
  const all = [mail.subjectLine, mail.fromLine, ...mail.lines];
  const seen = new Set<string>();
  const flights: Tracked[] = [];
  for (const line of mail.lines) {
    const m = FLIGHT_LINE.exec(line);
    const name = m ? AIRLINES[m[1]!] : undefined;
    if (!m || !name) continue;
    const value = `${m[1]} ${m[2]}`;
    const named = all.find((l) => l.toLowerCase().includes(name.toLowerCase()));
    if (!named || seen.has(value)) continue;
    seen.add(value);
    flights.push({ kind: "flight", airline: { value: name, line: named }, flight: { value, line } });
  }
  return flights;
}
