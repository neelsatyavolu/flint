// Executes thread actions on the server for the messages the store reports in `ActionResult.locations`.
// Port of packages/core/src/mail/actions.ts. Work is batched per source folder; failures are returned per message and
// nothing throws for a server error.
//
// Gmail: archive and "move to inbox" cannot edit labels (SwiftMail has no X-GM-LABELS store), so they use what Apple Mail
// uses. Archive is a MOVE out of INBOX into All Mail (the Inbox label goes away), moving into the inbox is a COPY into
// INBOX from All Mail, and mail in Trash or Spam is restored by a MOVE to INBOX first.

import FlintModel
import FlintStore
import Foundation

/// Runs work on the account's command connection, one operation at a time. `AccountSession` implements it.
public protocol TransportRunner: Sendable {
    func run<T: Sendable>(_ body: @Sendable (any MailTransport) async throws -> T) async throws -> T
}

extension MailTransport {
    /// Selects `path` (read-write unless asked) and runs `body` against it.
    func withMailbox<T: Sendable>(_ path: String, readOnly: Bool = false, _ body: () async throws -> T) async throws -> T {
        _ = try await select(path, readOnly: readOnly, qresync: nil)
        return try await body()
    }
}

public struct ActionError: Hashable, Sendable {
    public var op: String
    public var messageRowId: MessageRowID
    public var folderPath: String
    public var uid: Int
    public var message: String
}

public struct ActionReport: Hashable, Sendable {
    public var ok: Bool
    public var errors: [ActionError]
    /// Messages whose server operation failed. The caller restores their threads from the action snapshot.
    public var failedMessageIds: [MessageRowID]

    public init(errors: [ActionError] = []) {
        self.ok = errors.isEmpty
        self.errors = errors
        var seen = Set<MessageRowID>()
        self.failedMessageIds = errors.map(\.messageRowId).filter { seen.insert($0).inserted }
    }

    public static let success = ActionReport()

    public static func merged(_ reports: [ActionReport]) -> ActionReport { ActionReport(errors: reports.flatMap(\.errors)) }
}

public typealias ServerActionsStore = FoldersRepository & ThreadsRepository

public struct ServerActions: Sendable {
    private let store: any ServerActionsStore
    private let accountId: AccountID
    private let runner: any TransportRunner

    public init(store: any ServerActionsStore, accountId: AccountID, runner: any TransportRunner) {
        self.store = store
        self.accountId = accountId
        self.runner = runner
    }

    private struct Group { var folderId: FolderID; var path: String; var locs: [MessageLocation] }
    private struct Target { var id: FolderID; var path: String }

    // MARK: Public operations

    public func setSeen(_ locs: [MessageLocation], _ seen: Bool) async -> ActionReport { await flag(locs, IMAPFlag.seen, on: seen, op: "setSeen") }
    public func setFlagged(_ locs: [MessageLocation], _ flagged: Bool) async -> ActionReport { await flag(locs, IMAPFlag.flagged, on: flagged, op: "setFlagged") }
    public func setAnswered(_ locs: [MessageLocation]) async -> ActionReport { await flag(locs, IMAPFlag.answered, on: true, op: "setAnswered") }

    /// Gmail takes the message out of INBOX; other servers MOVE to the Archive folder, created when missing.
    public func archive(_ locs: [MessageLocation]) async -> ActionReport {
        var errors: [ActionError] = []
        let gmail = locs.filter(Self.isGmail)
        let generic = locs.filter { !Self.isGmail($0) && !Self.staysPut($0) && $0.folderRole != .archive }
        await gmailLeaveInbox(gmail.filter { !Self.inTrashOrSpam($0) }, op: "archive", errors: &errors)
        await restoreFromTrash(gmail.filter(Self.inTrashOrSpam), label: nil, op: "archive", errors: &errors)
        if let first = generic.first, let target = await roleTarget(first.accountId, .archive, locs: generic, op: "archive", errors: &errors) {
            await move(generic, to: target, op: "archive", errors: &errors)
        }
        return ActionReport(errors: errors)
    }

    public func trash(_ locs: [MessageLocation]) async -> ActionReport { await toRole(locs.filter { $0.folderRole != .trash }, .trash) }
    public func spam(_ locs: [MessageLocation]) async -> ActionReport { await toRole(locs.filter { $0.folderRole != .spam }, .spam) }
    /// Not spam: back to the inbox.
    public func unspam(_ locs: [MessageLocation]) async -> ActionReport { await moveToInbox(locs) }

    public func moveToInbox(_ locs: [MessageLocation]) async -> ActionReport {
        var errors: [ActionError] = []
        let gmail = locs.filter(Self.isGmail)
        let inbox = await inboxPath()
        // Gmail copies mail out of Trash and Spam into INBOX; the next sync reconciles the location.
        await each(groupByFolder(gmail.filter { !Self.inTrashOrSpam($0) }), op: "moveToInbox", errors: &errors) { t, g in
            _ = try await t.copy(.uids(g.locs.map(\.uid)), to: inbox)
        }
        await each(groupByFolder(gmail.filter(Self.inTrashOrSpam)), op: "moveToInbox", errors: &errors) { t, g in
            _ = try await t.move(.uids(g.locs.map(\.uid)), to: inbox)
        }
        let generic = locs.filter { !Self.isGmail($0) && !Self.staysPut($0) && $0.folderRole != .inbox }
        if let first = generic.first, let target = await roleTarget(first.accountId, .inbox, locs: generic, op: "moveToInbox", errors: &errors) {
            await move(generic, to: target, op: "moveToInbox", errors: &errors)
        }
        return ActionReport(errors: errors)
    }

    public func moveToFolder(_ locs: [MessageLocation], _ folderId: FolderID) async -> ActionReport {
        guard let folder = try? await store.folder(id: folderId) else { return Self.failAll(locs, op: "moveToFolder", message: "That folder no longer exists.") }
        switch folder.role {
        case .trash, .spam: return await toRole(locs, folder.role!)
        case .archive, .all: return await archive(locs)
        case .inbox: return await moveToInbox(locs)
        default: break
        }
        var errors: [ActionError] = []
        let gmail = locs.filter(Self.isGmail)
        await restoreFromTrash(gmail.filter(Self.inTrashOrSpam), label: folder.path, op: "moveToFolder", errors: &errors)
        // A Gmail label: apply it (COPY into the label) and take the message out of the inbox.
        let labelled = gmail.filter { !Self.inTrashOrSpam($0) }
        await each(groupByFolder(labelled), op: "moveToFolder", errors: &errors) { t, g in
            _ = try await t.copy(.uids(g.locs.map(\.uid)), to: folder.path)
        }
        let failed = Set(errors.map(\.messageRowId))
        await gmailLeaveInbox(labelled.filter { !failed.contains($0.messageRowId) }, op: "moveToFolder", errors: &errors)
        let generic = locs.filter { !Self.isGmail($0) && !Self.staysPut($0) }
        await move(generic, to: Target(id: folder.id, path: folder.path), op: "moveToFolder", errors: &errors)
        return ActionReport(errors: errors)
    }

    // MARK: Gmail helpers

    private func inboxPath() async -> String {
        (try? await store.folder(accountId: accountId, role: .inbox))?.path ?? "INBOX"
    }

    private func allMailPath() async -> String? {
        (try? await store.folder(accountId: accountId, role: .all))?.path
    }

    /// Removes the Inbox label by moving the INBOX copy into All Mail. Mail that is not in INBOX is already archived.
    private func gmailLeaveInbox(_ locs: [MessageLocation], op: String, errors: inout [ActionError]) async {
        guard !locs.isEmpty else { return }
        guard let allMail = await allMailPath() else {
            Self.pushAll(&errors, locs, op: op, message: "This account has no All Mail folder to archive into.")
            return
        }
        let inbox = await inboxPath()
        var local: [ActionError] = []
        for group in groupByFolder(locs) {
            if group.locs.contains(where: { $0.accountId != accountId }) {
                Self.pushAll(&local, group.locs, op: op, message: "That message belongs to another account.")
                continue
            }
            do {
                try await runner.run { t in
                    try await t.withMailbox(inbox) {
                        var uids: [Int] = []
                        for loc in group.locs {
                            guard let id = loc.messageId else { throw FlintError(.invalid, "The message has no Message-ID, so it cannot be found in the inbox.") }
                            uids += try await t.search(.header(name: "message-id", value: MailHeaders.unbracketed(id)))
                        }
                        if !uids.isEmpty { _ = try await t.move(.uids(Array(Set(uids)).sorted()), to: allMail) }
                    }
                }
            } catch {
                Self.pushAll(&local, group.locs, op: op, message: Self.describe(error))
            }
        }
        errors += local
    }

    /// Gmail keeps trashed and spam mail out of All Mail, so labels cannot be edited in place. Move it to the inbox,
    /// then (using the new UIDs) add the target label and leave the inbox. Failing to learn the new UIDs is reported,
    /// never swallowed: the mail is then safe in the inbox but not where the caller asked.
    private func restoreFromTrash(_ locs: [MessageLocation], label: String?, op: String, errors: inout [ActionError]) async {
        guard !locs.isEmpty else { return }
        let inbox = await inboxPath()
        let allMail = await allMailPath()
        for group in groupByFolder(locs) {
            if group.locs.contains(where: { $0.accountId != accountId }) {
                Self.pushAll(&errors, group.locs, op: op, message: "That message belongs to another account.")
                continue
            }
            do {
                let moved: [Int: Int] = try await runner.run { t in
                    try await t.withMailbox(group.path) { try await t.move(.uids(group.locs.map(\.uid)), to: inbox) }
                }
                guard !moved.isEmpty else { throw FlintError(.network, "The server restored the message to the inbox but did not report where it went.") }
                let fresh = Array(moved.values).sorted()
                try await runner.run { t in
                    try await t.withMailbox(inbox) {
                        if let label { _ = try await t.copy(.uids(fresh), to: label) }
                        if let allMail { _ = try await t.move(.uids(fresh), to: allMail) }
                    }
                }
            } catch {
                Self.pushAll(&errors, group.locs, op: op, message: Self.describe(error))
            }
        }
    }

    // MARK: Generic helpers

    private func toRole(_ locs: [MessageLocation], _ role: MailboxRole) async -> ActionReport {
        var errors: [ActionError] = []
        guard let first = locs.first else { return .success }
        if let target = await roleTarget(first.accountId, role, locs: locs, op: role.rawValue, errors: &errors) {
            await move(locs, to: target, op: role.rawValue, errors: &errors)
        }
        return ActionReport(errors: errors)
    }

    private func roleTarget(_ accountId: AccountID, _ role: MailboxRole, locs: [MessageLocation], op: String, errors: inout [ActionError]) async -> Target? {
        do {
            let folder = try await store.ensureFolder(accountId: accountId, role: role)
            return Target(id: folder.id, path: folder.path)
        } catch {
            Self.pushAll(&errors, locs, op: op, message: (error as? FlintError)?.message ?? "No \(role.rawValue) folder.")
            return nil
        }
    }

    private func move(_ locs: [MessageLocation], to target: Target, op: String, errors: inout [ActionError]) async {
        let groups = groupByFolder(locs.filter { $0.folderId != target.id })
        await each(groups, op: op, errors: &errors) { t, g in
            let map = try await Self.moveCreating(t, .uids(g.locs.map(\.uid)), to: target.path)
            for loc in g.locs { if let newUid = map[loc.uid] { try await store.relocateMessage(loc.messageRowId, folderId: target.id, uid: newUid) } }
        }
    }

    private func flag(_ locs: [MessageLocation], _ flag: String, on: Bool, op: String) async -> ActionReport {
        var errors: [ActionError] = []
        await each(groupByFolder(locs), op: op, errors: &errors) { t, g in
            try await t.storeFlags(.uids(g.locs.map(\.uid)), flags: [flag], mode: on ? .add : .remove)
        }
        return ActionReport(errors: errors)
    }

    /// Runs `body` for each group with the group's folder selected read-write. A failing group is reported, not thrown.
    private func each(
        _ groups: [Group], op: String, errors: inout [ActionError], _ body: @Sendable @escaping (any MailTransport, Group) async throws -> Void
    ) async {
        for group in groups {
            if group.locs.contains(where: { $0.accountId != accountId }) {
                Self.pushAll(&errors, group.locs, op: op, message: "That message belongs to another account.")
                continue
            }
            do {
                try await runner.run { t in try await t.withMailbox(group.path) { try await body(t, group) } }
            } catch {
                Self.pushAll(&errors, group.locs, op: op, message: Self.describe(error))
            }
        }
    }

    /// MOVE. When the server refuses, create the folder (it may not exist yet) and try once more.
    static func moveCreating(_ t: any MailTransport, _ uids: UIDSet, to path: String) async throws -> [Int: Int] {
        do { return try await t.move(uids, to: path) } catch let failure as FlintError where failure.code == .notFound || failure.code == .invalid {
            try? await t.createFolder(path)
            do { return try await t.move(uids, to: path) } catch { throw FlintError(.invalid, "The server refused to move the message.") }
        }
    }

    private func groupByFolder(_ locs: [MessageLocation]) -> [Group] {
        var order: [FolderID] = []
        var groups: [FolderID: Group] = [:]
        for loc in locs {
            if groups[loc.folderId] == nil { order.append(loc.folderId); groups[loc.folderId] = Group(folderId: loc.folderId, path: loc.folderPath, locs: []) }
            groups[loc.folderId]?.locs.append(loc)
        }
        return order.compactMap { groups[$0] }
    }

    private static func isGmail(_ l: MessageLocation) -> Bool { l.provider == .gmail }
    private static func inTrashOrSpam(_ l: MessageLocation) -> Bool { l.folderRole == .trash || l.folderRole == .spam }
    private static func staysPut(_ l: MessageLocation) -> Bool { l.folderRole == .sent || l.folderRole == .drafts }

    private static func describe(_ error: Error) -> String {
        if let flint = error as? FlintError { return flint.message }
        return "The server refused the change."
    }

    private static func pushAll(_ errors: inout [ActionError], _ locs: [MessageLocation], op: String, message: String) {
        errors += locs.map { ActionError(op: op, messageRowId: $0.messageRowId, folderPath: $0.folderPath, uid: $0.uid, message: message) }
    }

    private static func failAll(_ locs: [MessageLocation], op: String, message: String) -> ActionReport {
        var errors: [ActionError] = []
        pushAll(&errors, locs, op: op, message: message)
        return ActionReport(errors: errors)
    }
}
