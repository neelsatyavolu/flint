// Attachment bytes cached under `<root>/attachments` (Caches on iOS, so the system may purge them and they are fetched again).
// Port of packages/core/src/mail/sync/attachments.ts.

import Foundation

public enum AttachmentCache {
    /// A filename that cannot escape its folder or upset a file system.
    public static func safeFilename(_ name: String, fallback: String = "attachment") -> String {
        let controls = CharacterSet.controlCharacters.union(CharacterSet(charactersIn: "\u{7f}"))
        var cleaned = String(String.UnicodeScalarView(name.unicodeScalars.filter { !controls.contains($0) }))
        cleaned = cleaned.replacingOccurrences(of: #"[\\/:*?"<>|]+"#, with: "_", options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(of: #"^[.\s]+"#, with: "", options: .regularExpression)
        cleaned = cleaned.replacingOccurrences(of: #"[.\s]+$"#, with: "", options: .regularExpression)
        cleaned = cleaned.trimmingCharacters(in: .whitespaces)
        if cleaned.isEmpty { return fallback }
        if cleaned.count <= 120 { return cleaned }
        let ext: String
        if let dot = cleaned.lastIndex(of: "."), dot != cleaned.startIndex, cleaned.distance(from: dot, to: cleaned.endIndex) <= 12 {
            ext = String(cleaned[dot...])
        } else {
            ext = ""
        }
        return String(cleaned.prefix(120 - ext.count)) + ext
    }

    public static func path(root: URL, accountId: String, messageRowId: Int, attachmentId: Int, filename: String) -> URL {
        root.appendingPathComponent("attachments", isDirectory: true)
            .appendingPathComponent(safeFilename(accountId, fallback: "account"), isDirectory: true)
            .appendingPathComponent(String(messageRowId), isDirectory: true)
            .appendingPathComponent("\(attachmentId)-\(safeFilename(filename))")
    }

    public static func read(_ path: String?) -> Data? {
        guard let path else { return nil }
        return try? Data(contentsOf: URL(fileURLWithPath: path))
    }

    /// Writes through a `.part` file and renames, so a reader never sees half an attachment.
    public static func write(_ data: Data, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temp = url.appendingPathExtension("part")
        try data.write(to: temp, options: .atomic)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        try FileManager.default.moveItem(at: temp, to: url)
    }
}
