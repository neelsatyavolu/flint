// Server inverses of the optimistic actions, used by undo. Port of packages/core/src/service/actionOps.ts.

import FlintModel
import FlintStore
import Foundation

public enum InverseOps {
    /// Puts each message back to its pre-change \Seen state (the store was restored first).
    public static let seen: InverseOp = { actions, locs, _ in
        .merged([await actions.setSeen(locs.filter(\.seen), true), await actions.setSeen(locs.filter { !$0.seen }, false)])
    }

    /// Puts each message back to its pre-change \Flagged state.
    public static let flagged: InverseOp = { actions, locs, _ in
        .merged([await actions.setFlagged(locs.filter(\.flagged), true), await actions.setFlagged(locs.filter { !$0.flagged }, false)])
    }

    private enum Home: Hashable { case inbox, trash, spam, archive, folder(FolderID) }

    /// Where a message lived before the action, from the snapshot's membership. Sent and draft mail never moves.
    private static func home(_ store: any FoldersRepository, _ memberFolderIds: [FolderID]) async -> Home? {
        var folders: [Folder] = []
        for id in memberFolderIds { if let folder = try? await store.folder(id: id) { folders.append(folder) } }
        let roles = Set(folders.compactMap(\.role))
        if roles.contains(.sent) || roles.contains(.drafts) { return nil }
        if roles.contains(.inbox) { return .inbox }
        if roles.contains(.trash) { return .trash }
        if roles.contains(.spam) { return .spam }
        if let user = folders.first(where: { $0.role == nil }) { return .folder(user.id) }
        if roles.contains(.archive) || roles.contains(.all) { return .archive }
        return nil
    }

    /// Sends each message back to the place the snapshot says it came from.
    public static func move(_ store: any FoldersRepository) -> InverseOp {
        { actions, locs, snapshot in
            var before: [MessageRowID: [FolderID]] = [:]
            for thread in snapshot.threads { for message in thread.messages { before[message.id] = message.memberFolderIds } }
            var groups: [Home: [MessageLocation]] = [:]
            for loc in locs {
                guard let place = await home(store, before[loc.messageRowId] ?? []) else { continue }
                groups[place, default: []].append(loc)
            }
            var reports: [ActionReport] = []
            if let inbox = groups[.inbox] { reports.append(await actions.moveToInbox(inbox)) }
            if let trash = groups[.trash] { reports.append(await actions.trash(trash)) }
            if let spam = groups[.spam] { reports.append(await actions.spam(spam)) }
            if let archive = groups[.archive] { reports.append(await actions.archive(archive)) }
            for (place, group) in groups {
                if case .folder(let id) = place { reports.append(await actions.moveToFolder(group, id)) }
            }
            return .merged(reports)
        }
    }
}
