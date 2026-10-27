import FlintModel
import Foundation

/// What the Codes strip shows and says. Pure, so it is tested without a screen.
enum CodesLogic {
    static let maxShown = 3

    /// Codes still valid at `nowMs`, unused first, then newest first, capped.
    static func visible(_ codes: [VerificationCode], nowMs: EpochMs) -> [VerificationCode] {
        let live = codes.filter { $0.expiresAt > nowMs }
        let ordered = live.sorted { a, b in
            if a.used != b.used { return !a.used }
            return a.receivedAt > b.receivedAt
        }
        return Array(ordered.prefix(maxShown))
    }

    /// Six digits read as "482 913"; anything else is shown as it is.
    static func display(_ code: String) -> String {
        guard code.count == 6, code.allSatisfy(\.isNumber) else { return code }
        return code.prefix(3) + " " + code.suffix(3)
    }

    static func remaining(_ code: VerificationCode, nowMs: EpochMs) -> String {
        let minutes = Int((Double(code.expiresAt - nowMs) / 60_000).rounded(.up))
        if minutes <= 1 { return String(localized: "Under a minute left", table: "Codes") }
        return String(localized: "\(minutes) min left", table: "Codes")
    }

    /// The code to copy automatically when it arrives with the app open: the newest unused one received after `sinceMs`.
    static func autoCopyCandidate(_ code: VerificationCode, settings: Settings.Codes) -> Bool {
        settings.enabled && settings.autoCopy && !code.used
    }
}
