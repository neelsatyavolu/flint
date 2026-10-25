import type { ParsedSearch, SearchFilter, SearchTerm } from "./types";

type RawToken = { text: string; quoted: boolean; minus: boolean };

const MAX_INPUT = 500;
const MAX_TOKENS = 40;

/** Splits on whitespace, keeping "quoted phrases" (also after key: and a leading minus) together. Unterminated quotes run to the end. */
function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < input.length && tokens.length < MAX_TOKENS) {
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;
    let text = "";
    let quoted = false;
    const minus = input[i] === "-";
    if (minus) i++;
    while (i < input.length && !/\s/.test(input[i]!)) {
      if (input[i] === '"') {
        quoted = true;
        i++;
        while (i < input.length && input[i] !== '"') text += input[i++];
        i++; // closing quote
      } else {
        text += input[i++];
      }
    }
    tokens.push({ text, quoted, minus });
  }
  return tokens;
}

/** Local-midnight epoch ms for YYYY-MM-DD, or null when the string is not a real date. */
export function parseDay(value: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

const empty = (): ParsedSearch => ({
  terms: [], from: [], to: [], cc: [], subject: [], in: [], account: [],
  hasAttachment: null, unread: null, pinned: null, snoozed: null, before: null, after: null,
});

const FILTER_KEYS = ["from", "to", "cc", "subject", "in", "account"] as const;

/**
 * Parses a search string. Never throws: anything it cannot understand (unknown
 * operators, bad dates, empty values) is kept as a plain search term.
 */
export function parseSearch(input: string): ParsedSearch {
  const out = empty();
  try {
    const terms: SearchTerm[] = [];
    for (const raw of tokenize(String(input ?? "").slice(0, MAX_INPUT))) {
      const negated = raw.minus && raw.text.length > 0;
      const body = raw.minus && !negated ? "-" : raw.text;
      if (!body) continue;
      if (!applyOperator(out, body, negated)) {
        terms.push({ text: body, phrase: raw.quoted && /\s/.test(body), negated });
      }
    }
    return { ...out, terms };
  } catch {
    return { ...empty(), terms: plainTerms(input) };
  }
}

function plainTerms(input: unknown): SearchTerm[] {
  return String(input ?? "").split(/\s+/).filter(Boolean).slice(0, MAX_TOKENS).map((text) => ({ text, phrase: false, negated: false }));
}

function applyOperator(out: ParsedSearch, body: string, negated: boolean): boolean {
  const colon = body.indexOf(":");
  if (colon <= 0) return false;
  const key = body.slice(0, colon).toLowerCase();
  const value = body.slice(colon + 1).trim();
  if (!value) return false;
  const lower = value.toLowerCase();

  if ((FILTER_KEYS as readonly string[]).includes(key)) {
    const list = out[key as (typeof FILTER_KEYS)[number]] as SearchFilter[];
    list.push({ value: key === "in" || key === "account" ? lower : value, negated });
    return true;
  }
  if (key === "has") {
    if (lower !== "attachment" && lower !== "attachments") return false;
    out.hasAttachment = !negated;
    return true;
  }
  if (key === "is") {
    if (lower === "unread" || lower === "read") out.unread = (lower === "unread") !== negated;
    else if (lower === "pinned") out.pinned = !negated;
    else if (lower === "snoozed") out.snoozed = !negated;
    else return false;
    return true;
  }
  if ((key === "before" || key === "after") && !negated) {
    const day = parseDay(value);
    if (day === null) return false;
    out[key] = day;
    return true;
  }
  return false;
}
