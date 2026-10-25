import type { Address } from "@flint/core";

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/** Splits on commas, semicolons and newlines that are outside quotes and angle brackets. */
function splitTokens(input: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuote = false;
  let inAngle = false;
  for (const ch of input) {
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === "<") inAngle = true;
    else if (!inQuote && ch === ">") inAngle = false;
    if (!inQuote && !inAngle && (ch === "," || ch === ";" || ch === "\n" || ch === "\r")) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((t) => t.trim()).filter(Boolean);
}

/** Parses one token: `a@b.co`, `<a@b.co>`, `Name <a@b.co>`, `"Last, First" <a@b.co>`. */
export function parseAddress(token: string): Address | null {
  const t = token.trim();
  const angle = /^(.*?)<\s*([^<>\s]+)\s*>\s*$/.exec(t);
  if (angle) {
    const address = angle[2]!.trim();
    if (!isValidEmail(address)) return null;
    const name = angle[1]!.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').trim();
    return { name, address };
  }
  return isValidEmail(t) ? { name: "", address: t } : null;
}

export type ParsedList = { addresses: Address[]; invalid: string[] };

/** Parses pasted or typed text into addresses. Tokens that are not addresses come back in `invalid`. */
export function parseAddressList(input: string): ParsedList {
  const addresses: Address[] = [];
  const invalid: string[] = [];
  for (const token of splitTokens(input)) {
    const parsed = parseAddress(token);
    if (parsed) addresses.push(parsed);
    else invalid.push(token);
  }
  return { addresses, invalid };
}

/** Appends `add` to `list`, skipping addresses already present (case-insensitive). Returns a new array. */
export function mergeAddresses(list: Address[], add: Address[]): Address[] {
  const seen = new Set(list.map((a) => a.address.toLowerCase()));
  const next = [...list];
  for (const a of add) {
    const key = a.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(a);
  }
  return next;
}

export function removeAddress(list: Address[], address: string): Address[] {
  return list.filter((a) => a.address.toLowerCase() !== address.toLowerCase());
}

export function countRecipients(draft: { to: Address[]; cc: Address[]; bcc: Address[] }): number {
  return draft.to.length + draft.cc.length + draft.bcc.length;
}
