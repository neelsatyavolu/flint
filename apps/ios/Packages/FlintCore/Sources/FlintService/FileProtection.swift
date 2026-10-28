// The mail database is protected until the first unlock after boot (HANDOFF 2A/5D decision): background refresh must be able
// to open it while the phone is locked, which `complete` protection would forbid. The folder carries the class so the WAL and
// shared-memory files SQLite creates later inherit it. No effect on macOS, where the tests run.

import Foundation

enum FileProtection {
    static func prepare(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: directory.path)
        #endif
    }

    static func apply(toDatabaseAt path: String) {
        #if os(iOS)
        for suffix in ["", "-wal", "-shm"] {
            try? FileManager.default.setAttributes(
                [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: path + suffix)
        }
        #endif
    }
}
