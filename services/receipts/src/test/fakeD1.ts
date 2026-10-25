import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Minimal D1Database fake over node:sqlite: prepare/bind/first/all/run/batch. */
class FakeStatement {
  constructor(private readonly db: DatabaseSync, readonly sql: string, private readonly params: SQLInputValue[] = []) {}
  bind(...values: unknown[]): FakeStatement { return new FakeStatement(this.db, this.sql, values as SQLInputValue[]); }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: true }> { return { results: this.db.prepare(this.sql).all(...this.params) as T[], success: true }; }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export function createFakeD1(): { d1: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec(readFileSync(fileURLToPath(new URL("../../migrations/0001_init.sql", import.meta.url)), "utf8"));
  const d1 = {
    prepare: (sql: string) => new FakeStatement(raw, sql),
    async batch(stmts: FakeStatement[]) {
      raw.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        raw.exec("COMMIT");
        return out;
      } catch (e) { raw.exec("ROLLBACK"); throw e; }
    },
  };
  return { d1: d1 as unknown as D1Database, raw };
}
