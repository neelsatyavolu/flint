import { categorize } from "../categorize";
import type { Category } from "../types";
import { asCategory } from "./mappers";
import { recomputeThreads } from "./rollup";
import { addresses } from "./mappers";
import { parseJson, type Sql } from "./sql";

type Row = { id: number; thread_id: number; subject: string; from_json: string; headers_json: string; category: string | null; draft: number };

export class RecategorizeRepo {
  constructor(protected q: Sql) {}

  /**
   * Re-runs categorize() over stored received mail (headers_json, sender, subject, contact history) and rewrites
   * category where it changed, then recomputes the threads touched. Own sent mail and drafts keep their value.
   * Returns how many messages changed.
   */
  recategorizeAll(): number {
    const own = new Set(this.q.all<{ email: string; aliases: string }>("SELECT email, aliases FROM accounts").flatMap((a) => [a.email.toLowerCase(), ...parseJson<string[]>(a.aliases, []).map((x) => x.toLowerCase())]));
    const known = new Set(this.q.all<{ email: string }>("SELECT email FROM contacts WHERE sent_count > 0").map((c) => c.email));
    const rows = this.q.all<Row>("SELECT id, thread_id, subject, from_json, headers_json, category, draft FROM messages WHERE draft = 0");
    const touched = new Set<number>();
    let changed = 0;
    for (const r of rows) {
      const from = addresses(r.from_json)[0] ?? null;
      const address = from?.address.toLowerCase() ?? "";
      if (own.has(address)) continue;
      const next: Category = categorize({
        from, headers: parseJson<Record<string, string>>(r.headers_json, {}), isKnownContact: known.has(address), subject: r.subject,
      });
      if (next === (asCategory(r.category) ?? "people") && r.category !== null) continue;
      this.q.run("UPDATE messages SET category = ? WHERE id = ?", next, r.id);
      touched.add(r.thread_id);
      changed += 1;
    }
    recomputeThreads(this.q, touched);
    return changed;
  }
}
