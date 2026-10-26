import FlintModel
import Foundation
import SwiftUI

/// The undo window after Send: how long is left and how full the draining bar is. Pure, so tests pass `now`.
struct SendCountdown: Equatable, Sendable {
    let startedAt: Date
    let endsAt: Date

    init(startedAt: Date, undoUntil: EpochMs) {
        self.startedAt = startedAt
        self.endsAt = Date(timeIntervalSince1970: Double(undoUntil) / 1000)
    }

    var duration: TimeInterval { max(0, endsAt.timeIntervalSince(startedAt)) }

    func remaining(at now: Date) -> TimeInterval { min(duration, max(0, endsAt.timeIntervalSince(now))) }

    /// 1 when the window opens, 0 when it closes.
    func fraction(at now: Date) -> Double { duration > 0 ? remaining(at: now) / duration : 0 }

    /// "Sending in 10s", counting down. "Sent" once the window has closed.
    func message(at now: Date) -> String {
        let seconds = Int(remaining(at: now).rounded(.up))
        return seconds > 0 ? String(localized: "Sending in \(seconds)s", table: "Composer") : String(localized: "Sent", table: "Composer")
    }
}

/// A 2 pt bar that drains from full to empty over the undo window. Meant for the bottom edge of the send toast; the shell's
/// toast host embeds it (see HANDOFF).
struct SendCountdownBar: View {
    let countdown: SendCountdown
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: reduceMotion ? 1 : nil, paused: false)) { context in
            GeometryReader { proxy in
                FlintColor.accent
                    .frame(width: proxy.size.width * countdown.fraction(at: context.date), alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(height: 2)
        .accessibilityHidden(true)
        .accessibilityIdentifier("composer.countdown")
    }
}
