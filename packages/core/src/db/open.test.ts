import { describe, expect, it } from "vitest";
import { openDb } from "./open";
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
});
