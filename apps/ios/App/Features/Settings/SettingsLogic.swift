import FlintModel
import Foundation
import SwiftUI

/// Localized text from `Settings.xcstrings`. Keys are the English sentence.
func sl(_ key: String.LocalizationValue) -> String { String(localized: key, table: "Settings") }

/// Pure helpers behind the Settings screens, kept free of views so `SettingsLogicTests` can cover them.
enum SettingsPatch {
    /// A nested JSON patch: `object("inbox", "focused", .bool(false))` is `{"inbox": {"focused": false}}`.
    static func object(_ section: String, _ key: String, _ value: JSONValue) -> JSONValue {
        .object([section: .object([key: value])])
    }
}

/// One short status line for an account (port of `accountStatus.ts`).
struct AccountStatus: Equatable {
    enum Tone: Equatable { case ok, warn, error, muted }
    let text: String
    let tone: Tone
    let needsSignIn: Bool

    static func describe(sync: SyncStatus?, enabled: Bool, now: Date = Date(), time: FlintTime = .current) -> AccountStatus {
        if !enabled { return AccountStatus(text: sl("Paused"), tone: .muted, needsSignIn: false) }
        guard let sync else { return AccountStatus(text: sl("Waiting to sync"), tone: .muted, needsSignIn: false) }
        switch sync.state {
        case .syncing:
            if let p = sync.progress, p.total > 0 {
                return AccountStatus(text: String(format: sl("Syncing %lld of %lld"), p.done, p.total), tone: .muted, needsSignIn: false)
            }
            return AccountStatus(text: sl("Syncing"), tone: .muted, needsSignIn: false)
        case .authError:
            return AccountStatus(text: sl("Sign-in expired"), tone: .error, needsSignIn: true)
        case .error:
            return AccountStatus(text: sync.error ?? sl("Sync failed"), tone: .error, needsSignIn: false)
        case .offline:
            return AccountStatus(text: sl("Offline"), tone: .warn, needsSignIn: false)
        case .idle:
            guard let last = sync.lastSyncAt else { return AccountStatus(text: sl("Up to date"), tone: .ok, needsSignIn: false) }
            return AccountStatus(text: String(format: sl("Synced %@"), time.listTime(last, now: now)), tone: .ok, needsSignIn: false)
        }
    }
}

/// Alias validation (port of `checkAlias`).
enum AliasCheck: Equatable {
    case ok(String)
    case failure(String)

    static func check(_ raw: String, own: String, existing: [String]) -> AliasCheck {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        let valid = parts.count == 2 && !parts[0].isEmpty && parts[1].contains(".") && !parts[1].hasPrefix(".") && !parts[1].hasSuffix(".")
            && !value.contains(where: \.isWhitespace)
        if !valid { return .failure(sl("Enter a full email address.")) }
        if value == own.lowercased() { return .failure(sl("That is already the account address.")) }
        if existing.contains(where: { $0.lowercased() == value }) { return .failure(sl("That alias is already added.")) }
        return .ok(value)
    }
}

/// The eight account colors, the same hex values the desktop stores (`accountColors.ts`).
enum AccountPalette {
    static let hex: [String] = ["#b6706b", "#ae794c", "#978642", "#5d9669", "#339797", "#4a8fb5", "#7b80bc", "#a572a0"]

    static func color(hex: String) -> Color {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return FlintColor.fg3 }
        return Color(red: Double(value >> 16 & 0xFF) / 255, green: Double(value >> 8 & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    /// The swatch to show as selected; an account with no color shows none.
    static func isSelected(_ swatch: String, current: String?) -> Bool { swatch.lowercased() == current?.lowercased() }
}

/// Choices for the compose and inbox pages.
enum SettingsChoices {
    static let undoSendSeconds = [0, 5, 10, 20, 30]

    static func undoLabel(_ seconds: Int) -> String {
        seconds == 0 ? sl("Off") : String(format: sl("%lld seconds"), seconds)
    }
}

/// Where the Settings screens keep choices that are not part of the shared `Settings` model. Other features read these keys.
enum SettingsDefaultsKey {
    static let faceIDLock = "flint.privacy.faceIDLock"
}

/// The Settings view of the inbox swipe configuration (`SwipeConfiguration`, saved by the inbox): one choice per side, the
/// action a full swipe runs. Choosing an action moves it to the front and keeps the other actions of that side; nil clears it.
extension SwipeConfiguration {
    enum Side: Sendable { case leading, trailing }

    func primary(_ side: Side) -> SwipeAction? {
        (side == .leading ? leading : trailing).first
    }

    func choosing(_ action: SwipeAction?, for side: Side) -> SwipeConfiguration {
        let current = side == .leading ? leading : trailing
        let next = action.map { chosen in [chosen] + current.filter { $0 != chosen } } ?? []
        return side == .leading
            ? SwipeConfiguration(leading: next, trailing: trailing)
            : SwipeConfiguration(leading: leading, trailing: next)
    }

    static func choiceLabel(_ action: SwipeAction?) -> String {
        action?.title ?? sl("Nothing")
    }
}
