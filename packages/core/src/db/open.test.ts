import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, openDb } from "./open";
import { MIGRATIONS } from "./schema";

describe("openDb", () => {
  it("applies every migration and supports FTS5", () => {
    const db = openDb(":memory:");
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
    expect(user_version).toBe(MIGRATIONS.length);
    db.prepare("INSERT INTO messages_fts (rowid, subject, from_text, to_text, body_text) VALUES (1, 'Quarterly plan', 'a@b.c', '', 'budget')").run();
    const hit = db.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'budget'").get() as { rowid: number };
    expect(hit.rowid).toBe(1);
  });

  it("migration 8 backfills signatures.account_ids from account_id", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    for (let v = 0; v < 7; v++) db.exec(MIGRATIONS[v]!);
    db.exec("PRAGMA user_version = 7");
    db.exec(`INSERT INTO accounts (id, email, provider, auth_kind, imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure, username, created_at)
             VALUES ('acc1', 'a@x.co', 'imap', 'password', 'h', 993, 1, 'h', 465, 1, 'a', 0)`);
    db.exec(`INSERT INTO signatures (name, html, account_id, default_new, default_reply, updated_at) VALUES ('Mine', '<p>a</p>', 'acc1', 1, 0, 0), ('Shared', '<p>s</p>', NULL, 0, 1, 0)`);
    migrate(db);
    const rows = db.prepare("SELECT name, account_ids, account_id FROM signatures ORDER BY id").all() as { name: string; account_ids: string; account_id: string | null }[];
    expect(rows.map((r) => [r.name, JSON.parse(r.account_ids), r.account_id])).toEqual([["Mine", ["acc1"], "acc1"], ["Shared", [], null]]);
  });
});
