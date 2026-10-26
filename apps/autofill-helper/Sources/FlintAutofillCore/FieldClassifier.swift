import Foundation

/// The AX attributes of the focused element that matter for deciding whether it takes a one-time code.
/// The AX glue fills this from kAXRoleAttribute, kAXSubroleAttribute, AXPlaceholderValue, AXTitle, AXDescription,
/// AXHelp, the AXTitleUIElement's text, AXDOMIdentifier, AXDOMClassList, AXIdentifier; tests build it by hand.
public struct FieldAttributes: Equatable {
    public var role: String?
    public var subrole: String?
    public var placeholder: String?
    public var title: String?
    public var description: String?
    public var help: String?
    public var labelText: String?
    public var domIdentifier: String?
    public var domClasses: [String]
    public var identifier: String?
    /// Number of characters the field holds at most, when AX exposes it (split inputs are 1).
    public var maxLength: Int?
    public init(role: String? = nil, subrole: String? = nil, placeholder: String? = nil, title: String? = nil, description: String? = nil,
                help: String? = nil, labelText: String? = nil, domIdentifier: String? = nil, domClasses: [String] = [], identifier: String? = nil, maxLength: Int? = nil) {
        self.role = role; self.subrole = subrole; self.placeholder = placeholder; self.title = title; self.description = description
        self.help = help; self.labelText = labelText; self.domIdentifier = domIdentifier; self.domClasses = domClasses; self.identifier = identifier; self.maxLength = maxLength
    }
}

public enum FieldVerdict: Equatable {
    case codeField
    /// One box of a split input; `siblings` is how many adjacent single-character fields the AX glue found in the same group (1 when unknown).
    case splitCodeField(siblings: Int)
    case notCodeField
}

/// Decides from AX attributes whether a focused element takes a one-time code.
/// Order: secure fields never match; hard negatives (password, card, search, username, zip, promo ...) always win;
/// strong hints (otp, verification, 2fa, one-time, security code ...) match; weak hints (code, token, pin) match
/// unless a soft negative (email) is present; one-character fields are split inputs.
public enum FieldClassifier {
    public static let textRoles: Set<String> = ["AXTextField", "AXTextArea", "AXComboBox"]
    static let hardNegativeTokens: Set<String> = [
        "password", "passwd", "pwd", "cvv", "cvc", "cvn", "csc", "ccv", "cid", "cc", "card", "credit", "debit", "search", "username", "user",
        "zip", "postal", "postcode", "promo", "coupon", "discount", "voucher", "referral", "invite", "country", "area", "captcha", "ssn",
        "sort", "gift", "branch", "tracking", "encrypted", "payment", "billing", "checkout", "expiry", "expiration",
    ]
    /// Compounds written as one word (zipcode, promocode, creditcard ...). Long enough that a substring match cannot hit ordinary words.
    static let hardNegativeCompounds = [
        "password", "passwd", "cvv", "cvc", "creditcard", "debitcard", "cardnumber", "zipcode", "postalcode", "postcode", "promocode",
        "couponcode", "discount", "voucher", "referral", "giftcard", "giftcode", "sortcode", "countrycode", "areacode", "trackingcode",
        "captcha", "username", "branchcode",
    ]
    static let softNegativeTokens: Set<String> = ["email", "mail", "phone", "name", "address"]
    /// Soft negatives that mean "where the code was sent" rather than "what this field is": email and phone survive
    /// when the label also carries code-entry wording ("Enter the code we sent to your phone").
    static let channelTokens: Set<String> = ["email", "mail", "phone"]
    static let entryWording: Set<String> = ["sent", "send", "enter", "check", "received", "emailed", "texted", "we", "your", "digit", "digits", "inbox", "verify", "confirm", "text", "message"]
    static let strongTokens: Set<String> = ["otp", "totp", "otc", "2fa", "mfa", "verification", "passcode", "onetime", "onetimecode"]
    static let strongCompounds = ["verification", "twofactor", "onetime", "passcode", "authcode", "smscode", "securitycode", "logincode", "confirmationcode", "verifycode", "authenticationcode", "signincode", "2fa", "mfacode", "totp"]
    static let strongPhrases = ["one time", "two factor", "2 factor", "security code", "auth code", "authentication code",
                                "confirmation code", "sms code", "login code", "sign in code", "verify code"]
    static let weakTokens: Set<String> = ["code", "token", "pin"]
    static let splitTokens: Set<String> = ["digit", "character", "char", "box"]
    /// Words that say nothing about what a field is for; a split box with only these (or digits) in its hints is still a candidate.
    static let emptyTokens: Set<String> = ["input", "field", "text"]

    /// Lowercases, splits camelCase, letter/digit boundaries and every non-alphanumeric run into single spaces.
    static func normalize(_ text: String) -> String {
        var out = ""
        var previous: Character?
        for ch in text {
            if let p = previous {
                if ch.isUppercase, p.isLowercase { out.append(" ") }
                else if (ch.isNumber && p.isLetter) || (ch.isLetter && p.isNumber) { out.append(" ") }
            }
            out.append(ch.isLetter || ch.isNumber ? Character(ch.lowercased()) : " ")
            previous = ch
        }
        return out.split(separator: " ").joined(separator: " ")
    }

    private struct Hints {
        var texts: [String]
        var tokens: Set<String>
        var compact: [String]
    }

    private static func hints(_ a: FieldAttributes) -> Hints {
        let texts = ([a.placeholder, a.title, a.description, a.help, a.labelText, a.domIdentifier, a.identifier] + a.domClasses)
            .compactMap { $0 }.map(normalize).filter { !$0.isEmpty }
        return Hints(texts: texts, tokens: Set(texts.flatMap { $0.split(separator: " ").map(String.init) }), compact: texts.map { $0.replacingOccurrences(of: " ", with: "") })
    }

    private static func isHardNegative(_ h: Hints) -> Bool {
        !h.tokens.isDisjoint(with: hardNegativeTokens) || h.compact.contains { c in hardNegativeCompounds.contains { c.contains($0) } }
    }

    private static func isRefusedRole(_ a: FieldAttributes) -> Bool {
        a.role == "AXSecureTextField" || a.subrole == "AXSecureTextField" || a.subrole == "AXSearchField" || a.role == "AXSearchField"
    }

    /// True when a code must never be typed into this field, even on an explicit shortcut press: secure and search fields,
    /// and anything whose hints say password, card, search, username ... Fields that are merely unrecognised stay allowed.
    public static func isForbidden(_ a: FieldAttributes) -> Bool {
        isRefusedRole(a) || isHardNegative(hints(a))
    }

    public static func classify(_ a: FieldAttributes) -> FieldVerdict {
        if isRefusedRole(a) { return .notCodeField }
        guard let role = a.role, textRoles.contains(role) else { return .notCodeField }

        let h = hints(a)
        if isHardNegative(h) { return .notCodeField }
        let strong = !h.tokens.isDisjoint(with: strongTokens) || h.texts.contains { t in strongPhrases.contains { t.contains($0) } }
            || h.compact.contains { c in strongCompounds.contains { c.contains($0) } || c.hasPrefix("otp") || c.hasSuffix("otp") }
        let weak = !h.tokens.isDisjoint(with: weakTokens)
        let soft = !h.tokens.isDisjoint(with: softNegativeTokens)
        let channelOnly = soft && h.tokens.isDisjoint(with: softNegativeTokens.subtracting(channelTokens))
        let keepsWeak = !soft || (channelOnly && !h.tokens.isDisjoint(with: entryWording))
        let splitHint = !h.tokens.isDisjoint(with: splitTokens)
        let meaningless = h.tokens.allSatisfy { emptyTokens.contains($0) || $0.allSatisfy(\.isNumber) }
        let single = a.maxLength == 1

        if strong || (weak && keepsWeak) { return single ? .splitCodeField(siblings: 1) : .codeField }
        if single && (meaningless || splitHint) && !soft { return .splitCodeField(siblings: 1) }
        return .notCodeField
    }
}

/// One text field next to the focused one, as the AX glue reads it from the parent's children (document order).
public struct SiblingField: Equatable {
    public var isTextField: Bool
    public var isSecure: Bool
    public var maxLength: Int?
    public var frame: ScreenRect
    public init(isTextField: Bool, isSecure: Bool = false, maxLength: Int?, frame: ScreenRect) {
        self.isTextField = isTextField; self.isSecure = isSecure; self.maxLength = maxLength; self.frame = frame
    }
}

public enum SplitFields {
    /// Counts the run of adjacent single-character text fields containing `focused` (an index into `siblings`) and returns
    /// the run's start index and length. Non-text elements, secure fields and wider fields end a run. A run of one is not a split input.
    public static func run(siblings: [SiblingField], focused: Int) -> (start: Int, count: Int)? {
        func isBox(_ i: Int) -> Bool { siblings[i].isTextField && !siblings[i].isSecure && siblings[i].maxLength == 1 }
        guard siblings.indices.contains(focused), isBox(focused) else { return nil }
        var start = focused, end = focused
        while start > 0, isBox(start - 1) { start -= 1 }
        while end + 1 < siblings.count, isBox(end + 1) { end += 1 }
        let count = end - start + 1
        return count >= 2 ? (start, count) : nil
    }

    /// AX rarely exposes a field's maximum length, so this infers "one box of a split input" from layout: a run of at least four
    /// adjacent, same-sized, row-aligned, narrow (72 pt or less) text fields that contains `focused`.
    public static func looksLikeSplitBoxes(siblings: [SiblingField], focused: Int) -> Bool {
        guard siblings.indices.contains(focused) else { return false }
        let ref = siblings[focused].frame
        func isBox(_ s: SiblingField) -> Bool {
            s.isTextField && !s.isSecure && s.frame.width <= 72 && abs(s.frame.width - ref.width) <= 2
                && abs(s.frame.height - ref.height) <= 2 && abs(s.frame.y - ref.y) <= 4
        }
        guard isBox(siblings[focused]) else { return false }
        var start = focused, end = focused
        while start > 0, isBox(siblings[start - 1]) { start -= 1 }
        while end + 1 < siblings.count, isBox(siblings[end + 1]) { end += 1 }
        return end - start + 1 >= 4
    }
}
