import FlintModel
import Foundation

extension DraftPatch {
    /// This patch laid over `older`: fields set here win, the rest come from `older`.
    func merged(over older: DraftPatch) -> DraftPatch {
        DraftPatch(
            from: from ?? older.from, accountId: accountId ?? older.accountId, to: to ?? older.to, cc: cc ?? older.cc,
            bcc: bcc ?? older.bcc, subject: subject ?? older.subject, html: html ?? older.html,
            quotedHtml: quotedHtml ?? older.quotedHtml, attachments: attachments ?? older.attachments,
            signatureId: signatureId ?? older.signatureId, track: track ?? older.track, remindAt: remindAt ?? older.remindAt,
            threadId: threadId ?? older.threadId, sourceMessageId: sourceMessageId ?? older.sourceMessageId, mode: mode ?? older.mode)
    }
}

/// Debounced, serialized draft saver, ported from the desktop `autosave.ts`: one request at a time, patches that arrive
/// mid-save are batched into the next one, and a failed save keeps its patch and retries after 2 s, 5 s and 15 s.
@MainActor
final class DraftAutosaver {
    enum State: Equatable, Sendable { case idle, saving, saved, failed }

    struct SaveFailed: Error {}

    private let save: (DraftPatch) async throws -> Void
    private let delay: Duration
    private let retryDelays: [Duration]
    private let onState: (State) -> Void
    private var pending: DraftPatch?
    private var timer: Task<Void, Never>?
    private var running: Task<Void, Never>?
    private var retries = 0

    init(
        delay: Duration = .milliseconds(800), retryDelays: [Duration] = [.seconds(2), .seconds(5), .seconds(15)],
        onState: @escaping (State) -> Void = { _ in }, save: @escaping (DraftPatch) async throws -> Void
    ) {
        self.delay = delay
        self.retryDelays = retryDelays
        self.onState = onState
        self.save = save
    }

    var hasPending: Bool { pending != nil }

    /// Merges `part` into the pending patch and restarts the debounce timer.
    func push(_ part: DraftPatch) {
        pending = pending.map { part.merged(over: $0) } ?? part
        retries = 0
        schedule(after: delay)
    }

    /// Saves any pending patch now and returns once every save has finished. Throws when the last save failed.
    func flush() async throws {
        timer?.cancel()
        kick()
        await running?.value
        if pending != nil { throw SaveFailed() }
    }

    /// Drops the pending patch and the timer.
    func cancel() {
        timer?.cancel()
        pending = nil
    }

    private func schedule(after wait: Duration) {
        timer?.cancel()
        timer = Task { [weak self] in
            try? await Task.sleep(for: wait)
            guard !Task.isCancelled else { return }
            self?.kick()
        }
    }

    private func kick() {
        guard running == nil, pending != nil else { return }
        running = Task { [weak self] in
            await self?.drain()
            self?.running = nil
        }
    }

    private func drain() async {
        while let patch = pending {
            pending = nil
            onState(.saving)
            do {
                try await save(patch)
                retries = 0
            } catch {
                pending = pending.map { $0.merged(over: patch) } ?? patch
                onState(.failed)
                if retries < retryDelays.count {
                    schedule(after: retryDelays[retries])
                    retries += 1
                }
                return
            }
        }
        onState(.saved)
    }
}
