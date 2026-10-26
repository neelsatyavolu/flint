import FlintModel
import Foundation

/// How one message's HTML is presented, ported from the desktop `useMailAppearance`.
///
/// Light theme shows the mail as sent. Dark theme with "match" adapts the colors, or (when adapting would break the design)
/// shows the original on a light sheet. The Original / Adapted toggle flips whichever default applies, for the session.
struct MailAppearance: Equatable {
    /// What the page script does with the colors.
    enum Adapt: String, Sendable {
        /// Leave the colors alone.
        case none
        /// Try to adapt; fall back to the light sheet when the adapter says the mail cannot be adapted.
        case auto
        /// Adapt even when the adapter advises against it (the person asked for the dark version).
        case force
    }

    var adapt: Adapt
    /// The mail is drawn on a light sheet instead of the theme plane.
    var lightSheet: Bool
    /// The inline Original / Adapted toggle is offered.
    var canToggle: Bool
    /// The colors shown are the original ones.
    var showingOriginal: Bool

    /// - Parameters:
    ///   - dark: the resolved theme is Graphite.
    ///   - matchTheme: `settings.appearance.emailAppearance == .match`.
    ///   - flipped: the person tapped the toggle for this message.
    ///   - verdict: what the adapter said for this message once it ran; nil until then.
    static func resolve(dark: Bool, matchTheme: Bool, flipped: Bool, verdict: Bool?) -> MailAppearance {
        guard dark else { return MailAppearance(adapt: .none, lightSheet: false, canToggle: false, showingOriginal: true) }
        guard matchTheme else { return MailAppearance(adapt: .none, lightSheet: true, canToggle: false, showingOriginal: true) }
        let adaptable = verdict ?? true
        if !flipped { return MailAppearance(adapt: .auto, lightSheet: false, canToggle: true, showingOriginal: !adaptable) }
        // Flipped: an adaptable mail shows its original; one that was left alone shows the dark version.
        if adaptable { return MailAppearance(adapt: .none, lightSheet: true, canToggle: true, showingOriginal: true) }
        return MailAppearance(adapt: .force, lightSheet: false, canToggle: true, showingOriginal: false)
    }
}
