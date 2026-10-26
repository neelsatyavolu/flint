import FlintMail
import FlintModel
import FlintService
import Foundation

/// Actions on conversations. Each one runs through the service's optimistic pipeline, shows the desktop's toast with Undo,
/// and on failure shows "Couldn't archive. Try again." and returns false. Pass the ids of one row or a multi-selection.
extension AppModel {
    @discardableResult
    func archive(_ ids: [ThreadID]) async -> Bool {
        await perform(.archive, on: ids, closesThread: true) { try await $0.archive(ids) }
    }

    @discardableResult
    func trash(_ ids: [ThreadID]) async -> Bool {
        await perform(.trash, on: ids, closesThread: true) { try await $0.trash(ids) }
    }

    @discardableResult
    func markRead(_ ids: [ThreadID], read: Bool) async -> Bool {
        await perform(.read(read), on: ids) { try await $0.markRead(ids, read: read) }
    }

    @discardableResult
    func setPinned(_ ids: [ThreadID], pinned: Bool) async -> Bool {
        await perform(.pin(pinned), on: ids) { try await $0.setPinned(ids, pinned: pinned) }
    }

    @discardableResult
    func markSpam(_ ids: [ThreadID], spam: Bool) async -> Bool {
        await perform(.spam(spam), on: ids, closesThread: true) { try await $0.markSpam(ids, spam: spam) }
    }

    @discardableResult
    func move(_ ids: [ThreadID], to folder: Folder) async -> Bool {
        await perform(.move(folderName: folder.name), on: ids, closesThread: true) { try await $0.moveToFolder(ids, folderId: folder.id) }
    }

    @discardableResult
    func moveToInbox(_ ids: [ThreadID]) async -> Bool {
        await perform(.inbox, on: ids, closesThread: true) { try await $0.moveToInbox(ids) }
    }

    @discardableResult
    func snooze(_ ids: [ThreadID], until: EpochMs) async -> Bool {
        await perform(.snooze(until: until), on: ids, closesThread: true) { try await $0.snooze(ids, until: until) }
    }

    @discardableResult
    func unsnooze(_ ids: [ThreadID]) async -> Bool {
        await perform(.unsnooze, on: ids) { try await $0.unsnooze(ids) }
    }

    @discardableResult
    func setMuted(_ ids: [ThreadID], muted: Bool) async -> Bool {
        await perform(.mute(muted), on: ids) { try await $0.setMuted(ids, muted: muted) }
    }

    @discardableResult
    func setCategory(_ ids: [ThreadID], _ category: MailCategory, rememberSender: Bool = false) async -> Bool {
        await perform(.category(category, rememberSender: rememberSender), on: ids) {
            try await $0.setCategory(ids, category, rememberSender: rememberSender)
        }
    }

    /// Unsubscribes through the message's own method. `.browser(URL)` means the caller opens the link.
    func unsubscribe(messageId: MessageRowID) async -> UnsubscribeMethod? {
        do { return try await requireService().unsubscribe(messageId: messageId) } catch {
            report(error)
            return nil
        }
    }

    func blockSender(_ pattern: String) async {
        do { try await requireService().blockSender(pattern) } catch { report(error) }
    }

    /// Undoes an action by its token (valid 30 seconds). Says "Too late to undo that." when it can't.
    func undo(token: String) async {
        do {
            try await requireService().undo(token)
            toasts.show(String(localized: "Undone", table: "Shell"))
        } catch {
            toasts.show(String(localized: "Too late to undo that.", table: "Shell"), kind: .error)
        }
    }

    private func perform(
        _ action: ThreadAction, on ids: [ThreadID], closesThread: Bool = false, _ body: (FlintService) async throws -> String
    ) async -> Bool {
        guard !ids.isEmpty else { return false }
        do {
            let token = try await body(try requireService())
            if closesThread, let open = openThread, ids.contains(open) { openThread = nil }
            if let message = action.message(count: ids.count) {
                toasts.show(message, undo: { [weak self] in await self?.undo(token: token) })
            }
            return true
        } catch {
            toasts.show(action.failure, kind: .error)
            return false
        }
    }
}
