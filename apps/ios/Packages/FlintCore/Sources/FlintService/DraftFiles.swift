// Files that belong to a draft: attachments the user added or a forward carried over. They live in `drafts/<id>/` under
// the data directory (not Caches: a draft must survive memory pressure). Port of packages/core/src/service/compose-files.ts.

import FlintMail
import FlintModel
import FlintStore
import Foundation

enum DraftFiles {
    static let maxAttachmentBytes = 25 * 1024 * 1024

    static func directory(_ root: URL, draftId: Int) -> URL { root.appendingPathComponent(String(draftId), isDirectory: true) }

    /// Picks a name that is not taken by an attachment already on the draft.
    static func uniqueName(_ name: String, taken: Set<String>) -> String {
        if !taken.contains(name) { return name }
        let ext = (name as NSString).pathExtension
        let stem = (name as NSString).deletingPathExtension
        var n = 1
        while true {
            let candidate = ext.isEmpty ? "\(stem) (\(n))" : "\(stem) (\(n)).\(ext)"
            if !taken.contains(candidate) { return candidate }
            n += 1
        }
    }

    static func contentType(for filename: String) -> String {
        let table: [String: String] = [
            "txt": "text/plain", "md": "text/markdown", "csv": "text/csv", "html": "text/html", "htm": "text/html", "json": "application/json",
            "pdf": "application/pdf", "zip": "application/zip", "gz": "application/gzip", "tar": "application/x-tar",
            "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
            "heic": "image/heic", "mp3": "audio/mpeg", "wav": "audio/wav", "m4a": "audio/mp4", "mp4": "video/mp4", "mov": "video/quicktime",
            "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "ppt": "application/vnd.ms-powerpoint", "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "ics": "text/calendar", "eml": "message/rfc822",
        ]
        return table[(filename as NSString).pathExtension.lowercased()] ?? "application/octet-stream"
    }

    /// Copies a file the user chose into the draft's folder.
    static func copyIn(_ source: URL, to dir: URL, existing: [DraftAttachment]) throws -> DraftAttachment {
        let values = try? source.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard FileManager.default.fileExists(atPath: source.path) else { throw FlintError(.notFound, "Flint couldn't find that file.") }
        guard values?.isRegularFile == true else { throw FlintError(.invalid, "Choose a file, not a folder.") }
        let size = values?.fileSize ?? 0
        guard size <= maxAttachmentBytes else { throw FlintError(.invalid, "That file is larger than 25 MB.") }
        let name = uniqueName(AttachmentCache.safeFilename(source.lastPathComponent), taken: Set(existing.map(\.filename)))
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = dir.appendingPathComponent(name)
        try FileManager.default.copyItem(at: source, to: target)
        return DraftAttachment(id: UUID().uuidString.lowercased(), filename: name, contentType: contentType(for: name), size: size, path: target.path)
    }

    /// Saves bytes (a forwarded attachment) into the draft's folder.
    static func write(_ data: Data, filename: String, contentType: String, to dir: URL, existing: [DraftAttachment]) throws -> DraftAttachment {
        let name = uniqueName(AttachmentCache.safeFilename(filename.isEmpty ? "attachment" : filename), taken: Set(existing.map(\.filename)))
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let target = dir.appendingPathComponent(name)
        try data.write(to: target, options: .atomic)
        return DraftAttachment(
            id: UUID().uuidString.lowercased(), filename: name, contentType: contentType.isEmpty ? Self.contentType(for: name) : contentType,
            size: data.count, path: target.path)
    }

    /// Removes a file only when it sits inside the draft's own folder.
    static func remove(_ path: String, inside dir: URL) {
        let root = dir.standardizedFileURL.path + "/"
        guard URL(fileURLWithPath: path).standardizedFileURL.path.hasPrefix(root) else { return }
        try? FileManager.default.removeItem(atPath: path)
    }

    static func removeDirectory(_ dir: URL) { try? FileManager.default.removeItem(at: dir) }
}

/// What happens to a draft once its mail has been handed to SMTP: the local row, its files and its server copy go.
enum DraftCleanup {
    static func afterSend(
        _ sent: ScheduledSend, store: any Store, serverDrafts: ServerDrafts, draftsDirectory: URL, emit: @Sendable (FlintEvent) -> Void
    ) async {
        guard let draft = try? await store.draft(id: sent.draftId) else { return }
        await serverDrafts.remove(draft.id)
        try? await store.deleteDraft(draft.id)
        DraftFiles.removeDirectory(DraftFiles.directory(draftsDirectory, draftId: draft.id))
        emit(.mailChanged(accountId: draft.accountId, threadIds: draft.threadId.map { [$0] } ?? []))
    }
}
