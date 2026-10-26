import { htmlToText } from "../sanitize/htmlToText";

/**
 * Finds package tracking and flight numbers in one message. Pure: no I/O, no clock. Precision over recall: when unsure,
 * nothing. Every value comes with the line it was read from, verbatim but trimmed ("Subject: …" and "From: …" for headers).
 *
 * A package needs a tracking number behind a cue ("Tracking ID", "tracking number:"), or a carrier named in a subject
 * that is about an order or a delivery. A flight needs a line holding only a flight number ("UA 2090") from an airline
 * the mail names. Carriers and airlines are only the ones seen in real mail so far: add one together with a fixture.
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

const CARRIERS = [
  { name: "FedEx", text: /\bfedex\b/i, domain: /(?:^|\.)fedex\.com$/i },
  { name: "USPS", text: /\bUSPS\b/, domain: /(?:^|\.)usps\.com$/i },
  { name: "UniUni", text: /\buniuni\b/i, domain: /(?:^|\.)uniuni\.com$/i },
];

const AIRLINES: Record<string, string> = { UA: "United Airlines", AS: "Alaska Airlines" };

/** A tracking number is 10-34 letters and digits with at least 8 digits, right after the cue. */
const TRACKING_CUE = /\btracking\s*(?:number|id|no\.?|#)\s*:?\s*([A-Z0-9]{10,34})\b/i;
const SHIPPING_SUBJECT = /\b(?:order|package|shipment|shipped|deliver(?:y|ed)?|on the way)\b/i;
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
  const tracking = findTracking(mail.lines);
  if (tracking) {
    const carrier = carrierNamedIn(tracking.line) ?? carrierOfSender(mail) ?? firstCarrierLine([mail.subjectLine, ...mail.lines]);
    return { kind: "package", carrier, tracking };
  }
  if (!SHIPPING_SUBJECT.test(mail.subject)) return null;
  const carrier = carrierNamedIn(mail.subjectLine);
  return carrier ? { kind: "package", carrier, tracking: null } : null;
}

function findTracking(lines: string[]): Quote | null {
  for (const line of lines) {
    const token = TRACKING_CUE.exec(line)?.[1];
    if (token && (token.match(/\d/g)?.length ?? 0) >= 8) return { value: token.toUpperCase(), line };
  }
  return null;
}

function carrierNamedIn(line: string): Quote | null {
  const carrier = CARRIERS.find((c) => c.text.test(line));
  return carrier ? { value: carrier.name, line } : null;
}

function carrierOfSender(mail: Mail): Quote | null {
  const domain = mail.fromAddress.split("@")[1] ?? "";
  const carrier = CARRIERS.find((c) => c.domain.test(domain));
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
