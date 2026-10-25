import type { ParsedSearch, SearchFilter } from "./types";

export type SqlFragment = { sql: string; params: (string | number)[] };

/** Roles that `in:` understands directly. Anything else is matched against folder names and paths. */
const IN_ROLES = new Set(["inbox", "sent", "drafts", "trash", "spam", "archive"]);

/** Escapes % _ and \ for use in LIKE ... ESCAPE '\'. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Words an FTS5 tokenizer would see in `text`. Empty when the text is only punctuation. */
function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Builds an FTS5 MATCH string for the positive bare terms. Every term is a
 * quoted phrase of plain word characters, so user input can never be read as
 * FTS syntax. The last bare word (not a phrase) gets a prefix match.
 */
export function buildMatch(terms: ParsedSearch["terms"], prefixLast: boolean): string | null {
  const positive = terms.filter((t) => !t.negated).map((t) => ({ t, w: words(t.text) })).filter((x) => x.w.length > 0);
  if (positive.length === 0) return null;
  return positive
    .map(({ t, w }, i) => {
      const quoted = `"${w.join(" ")}"`;
      return prefixLast && i === positive.length - 1 && !t.phrase ? `${quoted} *` : quoted;
    })
    .join(" ");
}

function negatedMatches(terms: ParsedSearch["terms"]): string[] {
  return terms.filter((t) => t.negated).map((t) => words(t.text)).filter((w) => w.length > 0).map((w) => `"${w.join(" ")}"`);
}

const FTS_IN = "m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)";

/** SQL: message `m` is in a folder with this role. Written as IN (subquery) so SQLite can drive the query from the membership index. */
export function roleMember(role: string): string {
  return `m.id IN (SELECT xf.message_id FROM message_folders xf JOIN folders xr ON xr.id = xf.folder_id WHERE xr.role = '${role}')`;
}
const memberOfRole = roleMember;

/** Same definition as the archive view in the thread list. */
export const ARCHIVE_PREDICATE = `(
  ${memberOfRole("archive")}
  OR (EXISTS (SELECT 1 FROM accounts xa WHERE xa.id = m.account_id AND xa.provider = 'gmail')
      AND ${memberOfRole("all")}
      AND NOT ${memberOfRole("inbox")} AND NOT ${memberOfRole("trash")} AND NOT ${memberOfRole("spam")}
      AND NOT ${memberOfRole("sent")} AND NOT ${memberOfRole("drafts")})
)`;

function inFilter(f: SearchFilter): SqlFragment {
  let sql: string;
  const params: (string | number)[] = [];
  if (f.value === "archive") sql = ARCHIVE_PREDICATE;
  else if (IN_ROLES.has(f.value)) sql = memberOfRole(f.value);
  else {
    sql = "EXISTS (SELECT 1 FROM message_folders xf JOIN folders xr ON xr.id = xf.folder_id WHERE xf.message_id = m.id AND (lower(xr.name) = ? OR lower(xr.path) = ?))";
    params.push(f.value, f.value);
  }
  return { sql: f.negated ? `NOT ${sql}` : sql, params };
}

function likeFilter(column: string, f: SearchFilter): SqlFragment {
  return { sql: `${f.negated ? "NOT " : ""}${column} LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(f.value)}%`] };
}

/**
 * Turns a parsed search into a WHERE fragment over aliases `m` (messages) and
 * `t` (threads), plus whether the caller should exclude trash and spam (true
 * unless an `in:` filter says otherwise).
 */
export function buildSearchWhere(p: ParsedSearch, now: number): SqlFragment & { excludeTrashSpam: boolean } {
  const parts: string[] = [];
  const params: (string | number)[] = [];
  const add = (f: SqlFragment) => { parts.push(f.sql); params.push(...f.params); };

  const match = buildMatch(p.terms, true);
  if (match) { parts.push(FTS_IN); params.push(match); }
  for (const neg of negatedMatches(p.terms)) { parts.push(`m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)`); params.push(neg); }

  for (const f of p.from) add(likeFilter("m.from_json", f));
  for (const f of p.to) add(likeFilter("m.to_json", f));
  for (const f of p.cc) add(likeFilter("m.cc_json", f));
  for (const f of p.subject) add(likeFilter("m.subject", f));
  for (const f of p.in) add(inFilter(f));
  for (const f of p.account) {
    parts.push(`${f.negated ? "NOT " : ""}m.account_id IN (SELECT id FROM accounts WHERE lower(email) = ? OR id = ?)`);
    params.push(f.value, f.value);
  }
  if (p.hasAttachment !== null) parts.push(`m.has_attachments = ${p.hasAttachment ? 1 : 0}`);
  if (p.unread !== null) parts.push(`m.seen = ${p.unread ? 0 : 1}`);
  if (p.pinned !== null) parts.push(p.pinned ? "t.pinned = 1" : "t.pinned = 0");
  if (p.snoozed !== null) {
    parts.push(p.snoozed ? "(t.snoozed_until IS NOT NULL AND t.snoozed_until > ?)" : "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)");
    params.push(now);
  }
  if (p.before !== null) { parts.push("m.date < ?"); params.push(p.before); }
  if (p.after !== null) { parts.push("m.date >= ?"); params.push(p.after); }

  const positiveIn = p.in.some((f) => !f.negated);
  return { sql: parts.length ? parts.join(" AND ") : "1=1", params, excludeTrashSpam: !positiveIn };
}

/** True when the search has nothing to match on, so the caller can return an empty page. */
export function isEmptySearch(p: ParsedSearch): boolean {
  return !p.terms.some((t) => words(t.text).length > 0) && p.from.length + p.to.length + p.cc.length + p.subject.length + p.in.length + p.account.length === 0
    && p.hasAttachment === null && p.unread === null && p.pinned === null && p.snoozed === null && p.before === null && p.after === null;
}
