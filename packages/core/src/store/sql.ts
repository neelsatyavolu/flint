import type { SQLInputValue, StatementSync } from "node:sqlite";
import type { Db } from "../db/open";

export type Param = SQLInputValue | boolean | undefined;

const normalize = (p: Param): SQLInputValue => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p);

/** Thin typed wrapper over node:sqlite with a prepared-statement cache. The only place raw statements are executed. */
export class Sql {
  private cache = new Map<string, StatementSync>();
  constructor(readonly db: Db) {}

  #stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      if (this.cache.size > 300) this.cache.clear();
      s = this.db.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  all<T>(sql: string, ...params: Param[]): T[] {
    return this.#stmt(sql).all(...params.map(normalize)) as T[];
  }

  get<T>(sql: string, ...params: Param[]): T | undefined {
    return this.#stmt(sql).get(...params.map(normalize)) as T | undefined;
  }

  run(sql: string, ...params: Param[]): { changes: number; lastInsertRowid: number } {
    const r = this.#stmt(sql).run(...params.map(normalize));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  /** "?,?,?" for an IN list. */
  static marks(n: number): string {
    return Array.from({ length: n }, () => "?").join(",");
  }
}

/** Splits a long list so IN (...) stays under SQLite's variable limit. */
export function chunks<T>(items: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const bool = (v: unknown): boolean => v === 1 || v === true;

/**
 * Predicate for all-accounts views: leaves out accounts the user turned off for the unified inbox.
 * `col` is the account id column of the query. Queries for one account never use it.
 */
export const inUnified = (col: string): string => `${col} NOT IN (SELECT id FROM accounts WHERE show_in_unified = 0)`;
