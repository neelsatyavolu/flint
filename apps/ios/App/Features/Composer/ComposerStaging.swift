import Foundation

/// Temporary files for attachments that arrive as data (photos, camera shots). The service copies the file into the draft,
/// so the staged copy is removed straight after.
enum ComposerStaging {
    /// Writes `data` as `<temp>/<uuid>/<filename>` and returns the file.
    static func write(_ data: Data, filename: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("composer-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent(safeName(filename))
        try data.write(to: url, options: .atomic)
        return url
    }

    static func remove(_ file: URL) {
        try? FileManager.default.removeItem(at: file.deletingLastPathComponent())
    }

    /// A file name without path separators, never empty.
    static func safeName(_ name: String) -> String {
        let cleaned = name.replacingOccurrences(of: "/", with: "-").replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "Attachment" : cleaned
    }

    /// "Photo 2.jpg" style names for picked photos.
    static func photoName(index: Int, fileExtension: String?) -> String {
        "Photo \(index)." + (fileExtension?.isEmpty == false ? fileExtension! : "jpg")
    }
}
