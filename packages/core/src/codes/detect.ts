import { htmlToText } from "../sanitize/htmlToText";

/**
 * Finds a verification code in one message. Pure: no I/O, no clock. Precision over recall: when unsure, no code.
 *
 * Works on HTML-only mail (the html is converted to text). A code is only accepted next to a cue ("verification code",
 * "one time password", "OTP", ...): inline ("Your verification code is 262495"), reversed in a subject
 * ("530331 is your KAYAK verification code"), or alone on the line after a cue line. Years, phone numbers, prices, order
 * numbers and dates never qualify because the token must stand alone and follow a cue.
 */
export type DetectInput = {
  subject: string;
  text: string | null;
  html: string | null;
  fromName: string | null;
  fromAddress: string;
};

export type DetectedCode = {
  /** Normalized per VerificationCode.code: digit codes lose spaces and dashes, alphanumeric codes keep their dash. */
  code: string;
  service: string;
};

/** Bodies longer than this are newsletters or receipts, not code mails (the subject can still match). */
const MAX_BODY_CHARS = 6000;
const MAX_LINE_CHARS = 240;

const QUALIFIER = "verification|confirmation|security|authentication|authorization|login|log-in|log in|sign-in|sign in|signin|access|activation|registration|verify|auth|2fa|two-factor|two factor|two-step|2-step|one-time|one time|single-use|single use|device|email|sms|account|identity";
const STRONG_CUE = `(?:(?:${QUALIFIER})[ -]?(?:code|passcode|pass code|pin)|one[- ]?time[ -]?(?:password|passcode|pass code|code|pin)|otp|passcode|pass code)`;
/** Cues that may precede an alphanumeric code. A "confirmation code" can be a booking reference, so it only admits digits. */
const ALNUM_OK_CUE = /verif|authenticat|authoriz|security|log-?in|log in|sign[- ]?in|access|otp|one[- ]?time|single|2fa|two|2-step|pass ?code|auth|activation|device/i;

const TOKEN = String.raw`\d{4}[ -]\d{4}|\d{3}[ -]\d{3}|\d{4,8}|\d(?: \d){3,7}|\d{2}(?: \d{2}){2,3}|[a-z0-9]{3,4}-[a-z0-9]{3,4}|[a-z0-9]{6,8}`;
const BEFORE = String.raw`(?<![\w@.+\-/$#€£])`;
const AFTER = String.raw`(?![\w@\-/%]|[ -]\d|[.,]\d)`;
const TOKEN_RE = `${BEFORE}(${TOKEN})${AFTER}`;

const SEP = String.raw`[^\S\n]*(?:\([^)\n]{0,24}\))?[^\S\n]*(?:(?:is|was|are|:|：|=|-|–|—)[^\S\n]*){0,2}["'“”*\x60\[(]?`;
const INLINE = new RegExp(`\\b(${STRONG_CUE})\\b${SEP}${TOKEN_RE}`, "gi");
const BARE_INLINE = new RegExp(`\\b(?:your|the|this|my)[^\\S\\n]+code[^\\S\\n]+(?:is|was)[^\\S\\n]*:?[^\\S\\n]*["'“”*\x60\\[(]?${TOKEN_RE}`, "gi");
const REVERSED = new RegExp(`^\\W*${TOKEN_RE}[^\\S\\n]+(?:is|as)[^\\S\\n]+(?:your|the|my)[^\\S\\n]+([^\\n]{0,40}?)[^\\S\\n]*\\b(${STRONG_CUE}|code)\\b`, "i");
const BARE_REVERSED = new RegExp(`\\b(?:use|enter)[^\\S\\n]+${TOKEN_RE}[^\\S\\n]+(?:as|for)[^\\S\\n]+(?:your|the|my)[^\\S\\n]+([^\\n]{0,40}?)[^\\S\\n]*\\b(${STRONG_CUE})\\b`, "i");
const CUE_ANYWHERE = new RegExp(`\\b${STRONG_CUE}\\b`, "i");
const WEAK_CUE_LINE = /\b(?:enter|use|type|input|copy|paste|submit)\b[^.\n]{0,60}\b(?:code|passcode|otp|pin)\b[^.\n]{0,60}:\s*$/i;
const SOLE_TOKEN = new RegExp(`^${TOKEN_RE}$`, "i");
/** Lines that talk about the code or an incident rather than hand one over ("code settings", "may be compromised"). */
const NOT_A_HANDOVER = /\b(?:settings?|enabled|disabled|updated|changed|compromised|may be|might be|has been|have been|was used|were used|did not|didn't|unauthori[sz]ed|suspicious|reset|expired)\b/i;
/** A cue in a booking or order context is a reference number, not a one-time code. */
const NOT_A_CODE_CONTEXT = /\b(?:order|booking|reservation|itinerary|receipt|invoice|tracking|flight|ticket|promo|coupon|discount|gift)\b/i;

const YEAR_OK_CUE = /verification|otp|one[- ]?time/i;

type Hit = { token: string; cue: string };

function normalize(raw: string, cue: string): string | null {
  const t = raw.trim();
  const digitsOnly = t.replace(/[ -]/g, "");
  if (/^\d+$/.test(digitsOnly)) {
    if (digitsOnly.length < 4 || digitsOnly.length > 8) return null;
    // A year is only a code behind an explicit verification cue.
    if (digitsOnly.length === 4 && !/[ -]/.test(t) && /^(?:19|20)\d\d$/.test(digitsOnly) && !YEAR_OK_CUE.test(cue)) return null;
    if (/[ -]/.test(t)) {
      const groups = t.split(/[ -]/);
      const size = groups[0]!.length;
      const even = groups.every((g) => g.length === size);
      const halves = groups.length === 2 && even && (digitsOnly.length === 6 || digitsOnly.length === 8); // 3+3 or 4+4
      const singles = size === 1 && even; // 4 8 2 9 1 0
      const pairs = size === 2 && even && groups.length >= 3; // 12 34 56
      if (!halves && !singles && !pairs) return null;
    }
    return digitsOnly;
  }
  // Alphanumeric: uppercase with at least one digit and one letter. Without a dash it also needs a cue that names a login code.
  if (t !== t.toUpperCase() || !/\d/.test(t) || !/[A-Z]/.test(t) || /\s/.test(t)) return null;
  if (t.includes("-")) return /^[A-Z0-9]{3,4}-[A-Z0-9]{3,4}$/.test(t) ? t : null;
  return ALNUM_OK_CUE.test(cue) && /^[A-Z0-9]{6,8}$/.test(t) ? t : null;
}

function firstValid(matches: IterableIterator<RegExpMatchArray>, cueOf: (m: RegExpMatchArray) => string, tokenIndex: number): Hit | null {
  for (const m of matches) {
    const cue = cueOf(m);
    const token = normalize(m[tokenIndex] ?? "", cue);
    if (token) return { token, cue };
  }
  return null;
}

function findInline(line: string): Hit | null {
  if (line.length > MAX_LINE_CHARS * 2) return null;
  if (NOT_A_CODE_CONTEXT.test(line) || NOT_A_HANDOVER.test(line)) return null;
  return (
    firstValid(line.matchAll(INLINE), (m) => m[1] ?? "", 2) ??
    firstValid(line.matchAll(BARE_INLINE), () => "code", 1)
  );
}

function findReversed(line: string): { hit: Hit; service: string } | null {
  if (NOT_A_CODE_CONTEXT.test(line)) return null;
  const m = REVERSED.exec(line) ?? BARE_REVERSED.exec(line);
  if (!m) return null;
  const cue = m[3] ?? m[2] ?? "code";
  const token = normalize(m[1] ?? "", cue);
  return token ? { hit: { token, cue }, service: m[2] ?? "" } : null;
}

function isCueLine(line: string): boolean {
  if (!line || line.length > MAX_LINE_CHARS || NOT_A_CODE_CONTEXT.test(line) || NOT_A_HANDOVER.test(line)) return false;
  if (WEAK_CUE_LINE.test(line)) return true;
  if (!CUE_ANYWHERE.test(line)) return false;
  // The cue line introduces the code: it ends with a colon or "is", is a short label, or hands the code over ("you can copy it").
  const bare = line.replace(/[\s*_"'“”]+$/g, "");
  return /[:：]$/.test(bare) || /\b(?:is|are)$/i.test(bare) || bare.length <= 40 || /\b(?:copy|paste|use|enter|type)\b/i.test(bare);
}

/** The cue line, then (after at most two blank lines) a line holding nothing but the code. */
function findAfterCueLine(lines: string[]): Hit | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isCueLine(line)) continue;
    let j = i + 1;
    // A wrapped cue sentence continues on up to two more non-blank lines.
    for (let k = 0; k < 2 && j < lines.length && lines[j] !== "" && !SOLE_TOKEN.test(lines[j]!) && lines[j]!.length <= MAX_LINE_CHARS; k++) j++;
    while (j < lines.length && j <= i + 3 && lines[j]!.trim() === "") j++;
    const next = lines[j]?.trim().replace(/^[*_"'“”<>[\](){}]+|[*_"'“”<>[\](){}]+$/g, "").trim();
    if (!next) continue;
    const m = SOLE_TOKEN.exec(next);
    const cue = CUE_ANYWHERE.exec(line)?.[0] ?? line;
    const token = m ? normalize(m[1] ?? "", cue) : null;
    if (token) return { token, cue };
  }
  return null;
}

function bodyLines(text: string): string[] {
  return text.replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim());
}

// ---------- Service name ----------

const GENERIC_WORDS = new Set([
  "your", "the", "new", "my", "a", "an", "here", "here's", "heres", "is", "use", "please", "welcome", "to",
  "account", "email", "security", "login", "log-in", "sign-in", "signin", "verification", "confirmation", "authentication", "one-time", "temporary", "access", "device", "sms", "secure",
]);

function cleanService(raw: string): string | null {
  const words = raw.replace(/[:\-–—,.!?"“”'’]+$/g, "").replace(/^["“'‘]+/, "").trim().split(/\s+/).filter(Boolean);
  while (words.length && GENERIC_WORDS.has(words[0]!.toLowerCase())) words.shift();
  while (words.length && GENERIC_WORDS.has(words[words.length - 1]!.toLowerCase())) words.pop();
  const name = words.join(" ");
  if (!name || words.length > 4 || name.length > 40 || /[@\d]/.test(name)) return null;
  return name;
}

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** Registrable domain without a public suffix list: the last two labels, or three under a short second level (example.co.uk). */
export function registrableDomain(host: string): string {
  const labels = host.trim().toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function senderDomainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : registrableDomain(address.slice(at + 1));
}

const SENDER_NOISE = /\b(?:no[- ]?reply|do[- ]not[- ]reply|notifications?|team|support|security|accounts?|verification|verify|alerts?|mailer|info|service|help|login|auth|official|via .*)\b/gi;

function serviceFromSender(fromName: string | null, fromAddress: string): string {
  const named = cleanService((fromName ?? "").replace(SENDER_NOISE, " ").replace(/\s+/g, " "));
  if (named) return named;
  const label = senderDomainOf(fromAddress).split(".")[0] ?? "";
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown";
}

function serviceFromSubject(subject: string): string | null {
  const reversed = findReversed(subject);
  if (reversed) return cleanService(reversed.service);
  const m = new RegExp(`^(.{1,60}?)[^\\S\\n]*\\b${STRONG_CUE}\\b`, "i").exec(subject);
  return m ? cleanService(m[1] ?? "") : null;
}

// ---------- Entry point ----------

export function detectCode(input: DetectInput): DetectedCode | null {
  const subject = input.subject.replace(/\s+/g, " ").trim();
  const resolve = (token: string): DetectedCode => ({
    code: token,
    service: serviceFromSubject(subject) ?? serviceFromSender(input.fromName, input.fromAddress),
  });

  const fromSubject = findReversed(subject)?.hit ?? findInline(subject);
  if (fromSubject) return resolve(fromSubject.token);

  const bodies: string[] = [];
  if (input.text?.trim()) bodies.push(input.text);
  if (input.html?.trim()) bodies.push(htmlToText(input.html.slice(0, 200_000)));
  for (const body of bodies) {
    if (body.length > MAX_BODY_CHARS) continue;
    const lines = bodyLines(body);
    for (const line of lines) {
      const hit = findInline(line);
      if (hit) return resolve(hit.token);
    }
    const hit = findAfterCueLine(lines);
    if (hit) return resolve(hit.token);
  }
  return null;
}
