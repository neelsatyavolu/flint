// Leaves exactly one clean copy of a sent message in Sent. Port of the "Sent folder fix-up" in packages/core/src/mail/send.ts.
//
// Servers (Gmail, Exchange) file their own copy of a message sent over SMTP, and for a tracked send that copy would carry a
// tracking pixel. So: find copies by Message-ID, delete them, APPEND the clean copy with \Seen, then look once more for a copy
// the server filed late. On Gmail a copy that is also in the Inbox (the user was a recipient) is never deleted.

import FlintModel
import Foundation

public struct SentFolders: Sendable {
    public var provider: MailProvider
    /// Path of the Sent folder. When nil the server's `\Sent` special-use folder is used.
    public var sentPath: String?
    /// Gmail only: Trash path, used to really delete a server-saved copy.
    public var trashPath: String?
    /// Wait times in milliseconds between searches for a server-saved copy (Gmail files its own copy a moment after SMTP).
    /// Nil means the default for the provider, with the final re-check running in the background.
    public var delaysMs: [Int]?

    public init(provider: MailProvider, sentPath: String?, trashPath: String? = nil, delaysMs: [Int]? = nil) {
        self.provider = provider
        self.sentPath = sentPath
        self.trashPath = trashPath
        self.delaysMs = delaysMs
    }
}

public struct SentLocation: Hashable, Sendable {
    public var path: String
    public var uid: Int?
}

public struct SentCopy: Sendable {
    private let runner: any TransportRunner
    private let sleep: @Sendable (Int) async -> Void

    public init(runner: any TransportRunner, sleep: @escaping @Sendable (Int) async -> Void = { try? await Task.sleep(for: .milliseconds($0)) }) {
        self.runner = runner
        self.sleep = sleep
    }

    // MARK: Server helpers

    /// APPEND. When the server refuses, create the folder (it may not exist yet) and try once more.
    static func appendCreating(_ t: any MailTransport, path: String, mime: Data, flags: [String]) async throws -> Int? {
        do { return try await t.append(mime, to: path, flags: flags, date: nil) } catch let failure as FlintError where failure.code != .auth {
            try? await t.createFolder(path)
            do { return try await t.append(mime, to: path, flags: flags, date: nil) } catch { throw FlintError(.network, "The server would not save the message.") }
        }
    }

    private func specialUsePath(_ attribute: String) async throws -> String? {
        try await runner.run { t in try await t.listFolders().first { $0.attributes.contains(attribute) }?.path }
    }

    func findUids(path: String, messageId: String) async throws -> [Int] {
        try await runner.run { t in
            guard try await t.listFolders().contains(where: { $0.path == path }) else { return [] }
            return try await t.withMailbox(path, readOnly: true) {
                try await t.search(.header(name: "message-id", value: MailHeaders.unbracketed(messageId)))
            }
        }
    }

    func deleteUids(path: String, uids: [Int]) async throws {
        guard !uids.isEmpty else { return }
        try await runner.run { t in try await t.withMailbox(path) { try await t.expunge(.uids(uids)) } }
    }

    /// Gmail: the copies that also carry the Inbox label, i.e. the copy the user received (self or Bcc-self sends).
    private func gmailInboxCopies(path: String, uids: [Int]) async throws -> Set<Int> {
        guard !uids.isEmpty else { return [] }
        let rows = try await runner.run { t in
            try await t.withMailbox(path, readOnly: true) { try await t.fetchFlags(.uids(uids), includeLabels: true, changedSince: nil) }
        }
        return Set(rows.filter { ($0.labels ?? []).contains { $0.lowercased() == "\\inbox" || $0.lowercased() == "inbox" } }.map(\.uid))
    }

    /// Removes server-saved copies. On Gmail, mail that also has the Inbox label is the user's received copy and is never deleted.
    /// Returns the UIDs that were kept for that reason.
    private func removeServerCopies(_ folders: SentFolders, sentPath: String, found: [Int], messageId: String) async throws -> [Int] {
        guard !found.isEmpty else { return [] }
        let gmail = folders.provider == .gmail
        var trash: String?
        if gmail { trash = folders.trashPath; if trash == nil { trash = try await specialUsePath("trash") } }
        guard gmail, let trash else {
            try await deleteUids(path: sentPath, uids: found)
            return []
        }
        let keep = try await gmailInboxCopies(path: sentPath, uids: found)
        let doomed = found.filter { !keep.contains($0) }
        if !doomed.isEmpty {
            // Gmail keeps expunged mail in All Mail; moving to Trash and deleting there removes it for good.
            let moved = try await runner.run { t in try await t.withMailbox(sentPath) { try await t.move(.uids(doomed), to: trash) } }
            let trashed = moved.isEmpty ? try await findUids(path: trash, messageId: messageId) : Array(moved.values)
            try await deleteUids(path: trash, uids: trashed)
        }
        return Array(keep).sorted()
    }

    // MARK: File

    /// Returns the UID of the copy that remains in Sent when known.
    public func file(folders: SentFolders, messageId: String, cleanMime: Data, serverCopyIsClean: Bool = false) async throws -> SentLocation {
        var path = folders.sentPath
        if path == nil { path = try await specialUsePath("sent") }
        guard let sentPath = path else { throw FlintError(.notFound, "This account has no Sent folder to save the message in.") }
        let gmail = folders.provider == .gmail
        let delays = folders.delaysMs ?? (gmail ? [0, 1500, 4000] : [0])

        var found: [Int] = []
        for wait in delays {
            if wait > 0 { await sleep(wait) }
            found = try await findUids(path: sentPath, messageId: messageId)
            if !found.isEmpty { break }
        }
        if serverCopyIsClean, let first = found.first { return SentLocation(path: sentPath, uid: first) }

        let kept = try await removeServerCopies(folders, sentPath: sentPath, found: found, messageId: messageId)
        if let first = kept.first { return SentLocation(path: sentPath, uid: first) }
        let ours = try await runner.run { t in try await Self.appendCreating(t, path: sentPath, mime: cleanMime, flags: [IMAPFlag.seen]) }

        // Servers such as Exchange file their own copy a few seconds after SMTP. Look again and drop any copy that is not ours.
        // With the default schedule this runs in the background so sending does not wait for it; an explicit schedule runs inline.
        let recheck: @Sendable () async -> Void = {
            do {
                if folders.delaysMs == nil { await sleep(2500) }
                let late = try await findUids(path: sentPath, messageId: messageId).filter { $0 != ours }
                if ours != nil, !late.isEmpty { _ = try await removeServerCopies(folders, sentPath: sentPath, found: late, messageId: messageId) }
            } catch {
                return // best effort: the next sync shows the duplicate, which the user can delete
            }
        }
        if folders.delaysMs != nil { await recheck() } else { Task { await recheck() } }
        return SentLocation(path: sentPath, uid: ours)
    }
}
