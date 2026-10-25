import { chmodSync, closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "./schema";

export type Db = DatabaseSync;

/** Opens (or creates) the database and applies pending migrations. Use ':memory:' in tests. */
export function openDb(path: string): Db {
  if (path !== ":memory:" && path !== "") privatePlace(path);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}

/** The data folder is for this user only, and the database starts life 0600 so SQLite gives its -wal and -shm files the same mode. */
function privatePlace(path: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* not ours to change (a shared mount): the file mode below still holds */ }
  closeSync(openSync(path, "a", 0o600));
  chmodSync(path, 0o600);
}

export function migrate(db: Db): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw new Error(`Database migration ${v + 1} failed: ${(error as Error).message}`);
    }
  }
}

/** Runs fn inside a transaction (nested calls join the outer one). */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
