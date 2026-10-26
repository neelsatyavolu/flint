import Observation
import SwiftUI

/// The one visible toast: "Archived · Undo", an error, or an info line. A new toast replaces the current one, like the
/// desktop. Shown for five seconds (DESIGN.md "Menus, popovers, toasts"), or for the undo window of a send, which drains a bar.
@MainActor @Observable
final class ToastCenter {
    enum Kind: Sendable { case info, error }

    struct Toast: Identifiable {
        let id = UUID()
        let message: String
        let kind: Kind
        /// Runs when the person taps Undo. Nil hides the button.
        let undo: (@MainActor () async -> Void)?
        /// The undo window of a send: the toast counts down and stays up until it closes.
        var countdown: SendCountdown?
    }

    private(set) var current: Toast?
    private let duration: Duration
    private var dismissTask: Task<Void, Never>?

    init(duration: Duration = .seconds(5)) {
        self.duration = duration
    }

    func show(
        _ message: String, kind: Kind = .info, undo: (@MainActor () async -> Void)? = nil, countdown: SendCountdown? = nil, now: Date = Date()
    ) {
        guard !message.isEmpty else { return }
        dismissTask?.cancel()
        let toast = Toast(message: message, kind: kind, undo: undo, countdown: countdown)
        current = toast
        AccessibilityNotification.Announcement(message).post()
        let duration = countdown.map { Duration.milliseconds(Int($0.remaining(at: now) * 1000)) } ?? duration
        dismissTask = Task { [weak self, duration] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled else { return }
            self?.dismiss(id: toast.id)
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }

    private func dismiss(id: UUID) {
        guard current?.id == id else { return }
        current = nil
    }

    /// Runs the current toast's undo and closes it.
    func performUndo() async {
        guard let toast = current, let undo = toast.undo else { return }
        dismiss()
        await undo()
    }
}
