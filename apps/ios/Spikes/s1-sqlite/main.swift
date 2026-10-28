// Spike S1: SQLite version and FTS5 contentless_delete on the iOS simulator runtimes. Throwaway.
import Foundation
import SQLite3

func run(_ db: OpaquePointer?, _ sql: String) -> String {
    var err: UnsafeMutablePointer<CChar>?
    let rc = sqlite3_exec(db, sql, nil, nil, &err)
    if rc == SQLITE_OK { return "ok" }
    let m = err.map { String(cString: $0) } ?? "rc \(rc)"
    sqlite3_free(err)
    return "FAIL: \(m)"
}

var db: OpaquePointer?
sqlite3_open(":memory:", &db)
print("sqlite3_libversion = \(String(cString: sqlite3_libversion())) (\(sqlite3_libversion_number()))")
print("os = \(ProcessInfo.processInfo.operatingSystemVersionString)")
print("create contentless_delete fts5: " + run(db, "CREATE VIRTUAL TABLE m USING fts5(subject, body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2')"))
print("insert: " + run(db, "INSERT INTO m(rowid, subject, body) VALUES (1,'hello world','alpha beta'),(2,'second','gamma delta')"))
print("delete by rowid: " + run(db, "DELETE FROM m WHERE rowid = 1"))
var st: OpaquePointer?
sqlite3_prepare_v2(db, "SELECT rowid FROM m WHERE m MATCH 'alpha'", -1, &st, nil)
var hits = 0
while sqlite3_step(st) == SQLITE_ROW { hits += 1 }
sqlite3_finalize(st)
print("match alpha after delete (expect 0): \(hits)")
sqlite3_prepare_v2(db, "SELECT rowid FROM m WHERE m MATCH 'gam*'", -1, &st, nil)
hits = 0
while sqlite3_step(st) == SQLITE_ROW { hits += 1 }
sqlite3_finalize(st)
print("prefix gam* (expect 1): \(hits)")
print("contentless_delete + UPDATE: " + run(db, "UPDATE m SET body='epsilon' WHERE rowid = 2"))
for o in ["ENABLE_FTS5", "ENABLE_JSON1", "ENABLE_SNAPSHOT", "ENABLE_UPDATE_DELETE_LIMIT"] {
    print("compile option \(o): \(sqlite3_compileoption_used(o))")
}
