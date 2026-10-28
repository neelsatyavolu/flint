# S1: SQLite and FTS5 on the iOS runtimes

Run 2026-10-25 with Xcode 27.1 (`/Applications/Xcode.app`). A throwaway command-line binary linked against the system `libsqlite3`, compiled for `arm64-apple-ios26.0-simulator`, run with `simctl spawn` on fresh iPhone 17 simulators (deleted afterwards). Code: `apps/ios/Spikes/s1-sqlite/main.swift`.

| Runtime | `sqlite3_libversion()` | FTS5 | `contentless_delete=1` |
|---|---|---|---|
| iOS 26.5 (23F77) | 3.51.0 | yes | create, insert, delete by rowid, prefix `gam*` match: all work; a deleted row no longer matches |
| iOS 27.0 (24A5355p) | 3.54.0 | yes | same |

**Go.** Both runtimes are well above 3.43, so `messages_fts` keeps `contentless_delete=1` exactly as the desktop schema has it. No custom SQLite build, no shadow table.

One behavior to carry into track 2A: on a `contentless_delete` table, `UPDATE messages_fts SET body=... WHERE rowid=?` of a subset of columns fails with `cannot UPDATE a subset of columns on fts5 contentless-delete table`. The desktop already does `DELETE ... WHERE rowid = ?` then `INSERT (rowid, subject, from_text, to_text, body_text)` (`store/fts.ts`), so porting that verbatim is fine. Never port it as an UPDATE.

DESIGN-NOTES section 3: the "unverified" SQLite line is now verified (edited).
