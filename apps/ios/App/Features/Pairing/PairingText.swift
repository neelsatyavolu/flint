import FlintPairing
import Foundation

/// Strings for the pairing screens that depend on numbers. Pure, so they are unit tested.
enum PairingText {
    static func pl(_ key: String.LocalizationValue) -> String { String(localized: key, table: "Pairing") }

    private static func part(_ n: Int, one: String.LocalizationValue, many: String.LocalizationValue) -> String? {
        n > 0 ? "\(n) \(n == 1 ? pl(one) : pl(many))" : nil
    }

    /// "Added 2 accounts, 1 signature, 12 rules." Zero counts are left out.
    static func added(_ c: ImportCounts) -> String {
        let parts = [
            part(c.accounts, one: "account", many: "accounts"), part(c.signatures, one: "signature", many: "signatures"),
            part(c.templates, one: "template", many: "templates"), part(c.rules, one: "rule", many: "rules"),
            part(c.blockedSenders, one: "blocked sender", many: "blocked senders"),
        ].compactMap { $0 }
        guard !parts.isEmpty else { return pl("Nothing new was added. This iPhone already had everything.") }
        return pl("Added") + " " + parts.joined(separator: ", ") + "."
    }

    /// "2 accounts need Google sign-in." / "1 account needs a password." Empty when none.
    static func stillNeeds(google: Int, password: Int) -> [String] {
        var out: [String] = []
        if google > 0 { out.append(google == 1 ? pl("1 account needs Google sign-in. Do it from Settings > Accounts.") : "\(google) " + pl("accounts need Google sign-in. Do it from Settings > Accounts.")) }
        if password > 0 { out.append(password == 1 ? pl("1 account needs a password. Add it from Settings > Accounts.") : "\(password) " + pl("accounts need a password. Add them from Settings > Accounts.")) }
        return out
    }

    /// "3 new" or "3 new, 1 already here".
    static func libraryDetail(new: Int, already: Int) -> String {
        let base = "\(new) " + pl("new")
        return already > 0 ? base + ", \(already) " + pl("already here") : base
    }
}
