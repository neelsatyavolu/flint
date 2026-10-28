import CryptoKit
import Foundation

/// Names for the compiled content rule lists in `WKContentRuleListStore`. A name is the list's base plus a digest of its rules, so
/// it is the same on every launch (the stored copy is found instead of compiled again) and changes when the rules do (an older
/// copy is then stale and gets removed).
enum ReaderRuleIdentifier {
    static func stable(base: String, json: String) -> String {
        let digest = SHA256.hash(data: Data(json.utf8)).prefix(6).map { String(format: "%02x", $0) }.joined()
        return "\(base).\(digest)"
    }

    /// True for a stored list that belongs to `base` (the bare legacy name or any digest) and is not the one in use.
    static func isStale(_ stored: String, base: String, keeping current: String) -> Bool {
        stored != current && (stored == base || stored.hasPrefix(base + "."))
    }
}
