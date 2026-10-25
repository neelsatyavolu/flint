import type { Contact } from "../types";
import { lowerAddr } from "./mappers";
import type { Sql } from "./sql";
import type { Address } from "../types";

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export class ContactsRepo {
  constructor(protected q: Sql) {}

  touchReceived(a: Address, date: number): void {
    const email = lowerAddr(a);
    if (!email) return;
    this.q.run(
      `INSERT INTO contacts (email, name, received_count, last_seen) VALUES (?,?,1,?)
       ON CONFLICT (email) DO UPDATE SET received_count = received_count + 1,
         name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
         last_seen = MAX(last_seen, excluded.last_seen)`,
      email, a.name ?? "", date,
    );
  }

  touchSent(a: Address, date: number): void {
    const email = lowerAddr(a);
    if (!email) return;
    this.q.run(
      `INSERT INTO contacts (email, name, sent_count, last_seen) VALUES (?,?,1,?)
       ON CONFLICT (email) DO UPDATE SET sent_count = sent_count + 1,
         name = CASE WHEN contacts.name = '' THEN excluded.name ELSE contacts.name END,
         last_seen = MAX(last_seen, excluded.last_seen)`,
      email, a.name ?? "", date,
    );
  }

  /** True when the user has written to this address (sent_count > 0). */
  hasSentTo(address: string): boolean {
    const r = this.q.get<{ sent_count: number }>("SELECT sent_count FROM contacts WHERE email = ?", address.trim().toLowerCase());
    return (r?.sent_count ?? 0) > 0;
  }

  /** Autocomplete: prefix on the address or on any word of the name, ranked by sent_count*3 + received_count, then recency. */
  suggestContacts(prefix: string, limit = 8): Contact[] {
    const p = escapeLike(prefix.trim().toLowerCase());
    if (!p) return [];
    return this.q
      .all<{ email: string; name: string; score: number }>(
        `SELECT email, name, sent_count * 3 + received_count AS score FROM contacts
         WHERE email LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\' OR lower(name) LIKE ? ESCAPE '\\'
         ORDER BY score DESC, last_seen DESC, email LIMIT ?`,
        `${p}%`, `${p}%`, `% ${p}%`, Math.max(1, Math.min(limit, 50)),
      )
      .map((r) => ({ email: r.email, name: r.name, score: r.score }));
  }
}
