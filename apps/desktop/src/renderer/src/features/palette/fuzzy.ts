export type Range = [start: number, end: number];
export type Match = { score: number; ranges: Range[] };

const TIER = { prefix: 1000, wordStart: 800, acronym: 700, substring: 500, scattered: 200 } as const;

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const startsWord = (text: string, at: number) => at === 0 || !isWordChar(text[at - 1]) || (/[a-z]/.test(text[at - 1]!) && /[A-Z]/.test(text[at]!));

function merge(ranges: Range[]): Range[] {
  const out: Range[] = [];
  for (const r of ranges) {
    const last = out.at(-1);
    if (last && last[1] === r[0]) last[1] = r[1];
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** Letters of `token` taken from the first letters of consecutive words ("gi" in "Go to Inbox"). Words may be skipped. */
function acronym(token: string, text: string, lower: string): Match | null {
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) if (isWordChar(text[i]) && startsWord(text, i)) starts.push(i);
  const picked: number[] = [];
  let from = 0;
  for (const ch of token) {
    const w = starts.findIndex((s, i) => i >= from && lower[s] === ch);
    if (w < 0) return null;
    picked.push(starts[w]!);
    from = w + 1;
  }
  return { score: TIER.acronym - picked[0]! * 0.5, ranges: merge(picked.map((p) => [p, p + 1] as Range)) };
}

/** Letters of `token` in order, anywhere. Consecutive runs and word starts score higher. */
function scattered(token: string, text: string, lower: string): Match | null {
  const picked: number[] = [];
  let at = 0;
  let bonus = 0;
  for (const ch of token) {
    const i = lower.indexOf(ch, at);
    if (i < 0) return null;
    if (picked.length && i === picked.at(-1)! + 1) bonus += 6;
    if (startsWord(text, i)) bonus += 4;
    picked.push(i);
    at = i + 1;
  }
  const spread = picked.at(-1)! - picked[0]!;
  return { score: TIER.scattered + bonus - spread, ranges: merge(picked.map((p) => [p, p + 1] as Range)) };
}

/** One query word against one string. Tiers: prefix, word start, acronym, substring, scattered letters (3+ letters only). */
export function matchToken(token: string, text: string): Match | null {
  if (!token) return { score: 0, ranges: [] };
  const lower = text.toLowerCase();
  if (lower.startsWith(token)) return { score: TIER.prefix - (text.length - token.length) * 0.5, ranges: [[0, token.length]] };
  for (let i = lower.indexOf(token); i >= 0; i = lower.indexOf(token, i + 1)) {
    if (startsWord(text, i)) return { score: TIER.wordStart - i * 0.5, ranges: [[i, i + token.length]] };
  }
  if (token.length >= 2) {
    const a = acronym(token, text, lower);
    if (a) return a;
  }
  const at = lower.indexOf(token);
  if (at >= 0) return { score: TIER.substring - at * 0.5, ranges: [[at, at + token.length]] };
  return token.length >= 3 ? scattered(token, text, lower) : null;
}

/**
 * Every word of the query must match the label or the keywords. Label matches score full and carry highlight ranges;
 * keyword matches score half. Shorter labels win ties.
 */
export function rank(query: string, label: string, keywords = ""): Match | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { score: 0, ranges: [] };
  let total = 0;
  const ranges: Range[] = [];
  for (const w of words) {
    const inLabel = matchToken(w, label);
    const inWords = keywords ? matchToken(w, keywords) : null;
    if (inLabel && (!inWords || inLabel.score >= inWords.score / 2)) {
      total += inLabel.score;
      ranges.push(...inLabel.ranges);
    } else if (inWords) total += inWords.score / 2;
    else return null;
  }
  const sorted = ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const flat: Range[] = [];
  for (const r of sorted) {
    const last = flat.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else flat.push([r[0], r[1]]);
  }
  return { score: total / words.length - label.length * 0.1, ranges: flat };
}
