import Foundation

/// Input for `CodeDetector.detect`.
public struct DetectInput: Sendable {
    public var subject: String
    public var text: String?
    public var html: String?
    public var fromName: String?
    public var fromAddress: String

    public init(subject: String, text: String? = nil, html: String? = nil, fromName: String? = nil, fromAddress: String) {
        self.subject = subject
        self.text = text
        self.html = html
        self.fromName = fromName
        self.fromAddress = fromAddress
    }
}

public struct DetectedCode: Hashable, Sendable {
    /// Digit codes lose spaces and dashes, alphanumeric codes keep their dash.
    public var code: String
    public var service: String

    public init(code: String, service: String) {
        self.code = code
        self.service = service
    }
}

/// Finds a verification code in one message. Pure: no I/O, no clock. Precision over recall: when unsure, no code.
/// Port of `packages/core/src/codes/detect.ts`; see that file for the rules. A code is only accepted next to a cue
/// ("verification code", "one time password", "OTP", ...).
///
/// All regexes are ASCII-faithful to JavaScript (see `JSRegex`): full-width digits are never part of a code.
public struct CodeDetector: Sendable {
    /// HTML to plain text. Defaults to a small built-in converter; the facade may inject the FlintHTML one.
    public var htmlToText: @Sendable (String) -> String

    public init(htmlToText: (@Sendable (String) -> String)? = nil) {
        self.htmlToText = htmlToText ?? { SimpleHTMLText.convert($0) }
    }

    // MARK: Patterns

    private static let maxBodyChars = 6000
    private static let maxLineChars = 240

    private static let qualifier = "verification|confirmation|security|authentication|authorization|login|log-in|log in|sign-in|sign in|signin|access|activation|registration|verify|auth|2fa|two-factor|two factor|two-step|2-step|one-time|one time|single-use|single use|device|email|sms|account|identity"
    private static let strongCue = "(?:(?:\(qualifier))[ -]?(?:code|passcode|pass code|pin)|one[- ]?time[ -]?(?:password|passcode|pass code|code|pin)|otp|passcode|pass code)"
    private static let alnumOKCue = JSRegex(literal: #"verif|authenticat|authoriz|security|log-?in|log in|sign[- ]?in|access|otp|one[- ]?time|single|2fa|two|2-step|pass ?code|auth|activation|device"#, ignoreCase: true)

    private static let token = #"\d{4}[ -]\d{4}|\d{3}[ -]\d{3}|\d{4,8}|\d(?: \d){3,7}|\d{2}(?: \d{2}){2,3}|[a-z0-9]{3,4}-[a-z0-9]{3,4}|[a-z0-9]{6,8}"#
    private static let before = #"(?<![\w@.+\-/$#€£])"#
    private static let after = #"(?![\w@\-/%]|[ -]\d|[.,]\d)"#
    private static let tokenRe = before + "(" + token + ")" + after

    private static let sep = #"[^\S\n]*(?:\([^)\n]{0,24}\))?[^\S\n]*(?:(?:is|was|are|:|：|=|-|–|—)[^\S\n]*){0,2}["'“”*\x60\[(]?"#
    private static let inline = JSRegex(literal: #"\b("# + strongCue + #")\b"# + sep + tokenRe, ignoreCase: true)
    private static let bareInline = JSRegex(literal: #"\b(?:your|the|this|my)[^\S\n]+code[^\S\n]+(?:is|was)[^\S\n]*:?[^\S\n]*["'“”*\x60\[(]?"# + tokenRe, ignoreCase: true)
    private static let reversed = JSRegex(literal: #"^\W*"# + tokenRe + #"[^\S\n]+(?:is|as)[^\S\n]+(?:your|the|my)[^\S\n]+([^\n]{0,40}?)[^\S\n]*\b("# + strongCue + #"|code)\b"#, ignoreCase: true)
    private static let bareReversed = JSRegex(literal: #"\b(?:use|enter)[^\S\n]+"# + tokenRe + #"[^\S\n]+(?:as|for)[^\S\n]+(?:your|the|my)[^\S\n]+([^\n]{0,40}?)[^\S\n]*\b("# + strongCue + #")\b"#, ignoreCase: true)
    private static let cueAnywhere = JSRegex(literal: #"\b"# + strongCue + #"\b"#, ignoreCase: true)
    private static let weakCueLine = JSRegex(literal: #"\b(?:enter|use|type|input|copy|paste|submit)\b[^.\n]{0,60}\b(?:code|passcode|otp|pin)\b[^.\n]{0,60}:\s*\z"#, ignoreCase: true)
    private static let soleToken = JSRegex(literal: "^" + tokenRe + #"\z"#, ignoreCase: true)
    private static let notAHandover = JSRegex(literal: #"\b(?:settings?|enabled|disabled|updated|changed|compromised|may be|might be|has been|have been|was used|were used|did not|didn't|unauthori[sz]ed|suspicious|reset|expired)\b"#, ignoreCase: true)
    private static let notACodeContext = JSRegex(literal: #"\b(?:order|booking|reservation|itinerary|receipt|invoice|tracking|flight|ticket|promo|coupon|discount|gift)\b"#, ignoreCase: true)
    /// A meeting or webinar invite: its bare "Passcode" is for joining the call, not a one-time code.
    private static let meetingInvite = JSRegex(literal: #"\b(?:meeting|webinar)[ -]?(?:id|number)\b|\bjoin\s+(?:(?:the|this|our|zoom|teams)\s+)*(?:meeting|webinar)\b"#, ignoreCase: true)
    private static let barePasscodeCue = JSRegex(literal: #"^pass ?code\z"#, ignoreCase: true)
    private static let yearOKCue = JSRegex(literal: #"verification|otp|one[- ]?time"#, ignoreCase: true)

    private static let year = JSRegex(literal: #"^(?:19|20)\d\d\z"#)
    private static let dashedAlnum = JSRegex(literal: #"^[A-Z0-9]{3,4}-[A-Z0-9]{3,4}\z"#)
    private static let plainAlnum = JSRegex(literal: #"^[A-Z0-9]{6,8}\z"#)
    private static let hasLetter = JSRegex(literal: "[A-Z]")
    private static let hasDigit = JSRegex(literal: #"\d"#)
    private static let anySpace = JSRegex(literal: #"\s"#)
    private static let lineSpaces = JSRegex(literal: #"[ \t ]+"#)
    private static let trailingJunk = JSRegex(literal: #"[\s*_"'“”]+\z"#)
    private static let endsWithColon = JSRegex(literal: #"[:：]\z"#)
    private static let endsWithIs = JSRegex(literal: #"\b(?:is|are)\z"#, ignoreCase: true)
    private static let handoverVerb = JSRegex(literal: #"\b(?:copy|paste|use|enter|type)\b"#, ignoreCase: true)

    private struct Hit { var token: String; var cue: String }

    // MARK: Code normalization

    private static func isASCIIDigits(_ s: String) -> Bool {
        !s.isEmpty && s.unicodeScalars.allSatisfy { $0.value >= 0x30 && $0.value <= 0x39 }
    }

    private static func normalize(_ raw: String, cue: String) -> String? {
        let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let digitsOnly = t.replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "-", with: "")
        let separated = t.contains(" ") || t.contains("-")
        if isASCIIDigits(digitsOnly) {
            let n = digitsOnly.utf16.count
            if n < 4 || n > 8 { return nil }
            // A year is only a code behind an explicit verification cue.
            if n == 4 && !separated && year.test(digitsOnly) && !yearOKCue.test(cue) { return nil }
            if separated {
                let groups = t.split(omittingEmptySubsequences: false, whereSeparator: { $0 == " " || $0 == "-" })
                let size = groups[0].utf16.count
                let even = groups.allSatisfy { $0.utf16.count == size }
                let halves = groups.count == 2 && even && (n == 6 || n == 8)
                let singles = size == 1 && even
                let pairs = size == 2 && even && groups.count >= 3
                if !halves && !singles && !pairs { return nil }
            }
            return digitsOnly
        }
        // Alphanumeric: uppercase with at least one digit and one letter; without a dash it also needs a login-code cue.
        if t != t.uppercased() || !hasDigit.test(t) || !hasLetter.test(t) || anySpace.test(t) { return nil }
        if t.contains("-") { return dashedAlnum.test(t) ? t : nil }
        return alnumOKCue.test(cue) && plainAlnum.test(t) ? t : nil
    }

    private static func firstValid(_ matches: [JSRegex.Match], cue: (JSRegex.Match) -> String, tokenIndex: Int, meeting: Bool = false) -> Hit? {
        for m in matches {
            let c = cue(m)
            if meeting && barePasscodeCue.test(c) { continue }
            if let token = normalize(m[tokenIndex] ?? "", cue: c) { return Hit(token: token, cue: c) }
        }
        return nil
    }

    // MARK: Finders

    private static func findInline(_ line: String, meeting: Bool = false) -> Hit? {
        if line.utf16.count > maxLineChars * 2 { return nil }
        if notACodeContext.test(line) || notAHandover.test(line) { return nil }
        return firstValid(inline.all(in: line), cue: { $0[1] ?? "" }, tokenIndex: 2, meeting: meeting)
            ?? firstValid(bareInline.all(in: line), cue: { _ in "code" }, tokenIndex: 1)
    }

    private static func findReversed(_ line: String) -> (hit: Hit, service: String)? {
        if notACodeContext.test(line) { return nil }
        guard let m = reversed.first(in: line) ?? bareReversed.first(in: line) else { return nil }
        let cue = m[3] ?? m[2] ?? "code"
        guard let token = normalize(m[1] ?? "", cue: cue) else { return nil }
        return (Hit(token: token, cue: cue), m[2] ?? "")
    }

    private static func isCueLine(_ line: String) -> Bool {
        if line.isEmpty || line.utf16.count > maxLineChars || notACodeContext.test(line) || notAHandover.test(line) { return false }
        if weakCueLine.test(line) { return true }
        if !cueAnywhere.test(line) { return false }
        // The cue line introduces the code: it ends with a colon or "is", is a short label, or hands the code over.
        let bare = trailingJunk.replacing(in: line, with: "")
        return endsWithColon.test(bare) || endsWithIs.test(bare) || bare.utf16.count <= 40 || handoverVerb.test(bare)
    }

    private static let wrapChars = Set("*_\"'“”<>[](){}")

    private static func stripWrap(_ s: String) -> String {
        var chars = Substring(s)
        while let f = chars.first, wrapChars.contains(f) { chars = chars.dropFirst() }
        while let l = chars.last, wrapChars.contains(l) { chars = chars.dropLast() }
        return String(chars)
    }

    /// The cue line, then (after at most two blank lines) a line holding nothing but the code.
    private static func findAfterCueLine(_ lines: [String], meeting: Bool = false) -> Hit? {
        for i in lines.indices {
            let line = lines[i]
            if !isCueLine(line) { continue }
            if meeting && barePasscodeCue.test(cueAnywhere.first(in: line)?[0] ?? "") { continue }
            var j = i + 1
            // A wrapped cue sentence continues on up to two more non-blank lines.
            var k = 0
            while k < 2 && j < lines.count && lines[j] != "" && !soleToken.test(lines[j]) && lines[j].utf16.count <= maxLineChars {
                j += 1
                k += 1
            }
            while j < lines.count && j <= i + 3 && lines[j].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { j += 1 }
            guard j < lines.count else { continue }
            let next = stripWrap(lines[j].trimmingCharacters(in: .whitespacesAndNewlines)).trimmingCharacters(in: .whitespacesAndNewlines)
            if next.isEmpty { continue }
            let cue = cueAnywhere.first(in: line)?[0] ?? line
            if let m = soleToken.first(in: next), let token = normalize(m[1] ?? "", cue: cue) { return Hit(token: token, cue: cue) }
        }
        return nil
    }

    private static func bodyLines(_ text: String) -> [String] {
        text.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n").map {
            lineSpaces.replacing(in: $0, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    // MARK: Service name

    private static let genericWords: Set<String> = [
        "your", "the", "new", "my", "a", "an", "here", "here's", "heres", "is", "use", "please", "welcome", "to",
        "account", "email", "security", "login", "log-in", "sign-in", "signin", "verification", "confirmation", "authentication", "one-time", "temporary", "access", "device", "sms", "secure",
    ]
    private static let trailingPunct = JSRegex(literal: #"[:\-–—,.!?"“”'’]+\z"#)
    private static let leadingQuote = JSRegex(literal: #"^["“'‘]+"#)
    private static let atOrDigit = JSRegex(literal: #"[@\d]"#)
    private static let spaces = JSRegex(literal: #"\s+"#)
    private static let senderNoise = JSRegex(literal: #"\b(?:no[- ]?reply|do[- ]not[- ]reply|notifications?|team|support|security|accounts?|verification|verify|alerts?|mailer|info|service|help|login|auth|official|via .*)\b"#, ignoreCase: true)
    private static let subjectLead = JSRegex(literal: #"^(.{1,60}?)[^\S\n]*\b"# + strongCue + #"\b"#, ignoreCase: true)

    private static func cleanService(_ raw: String) -> String? {
        let stripped = leadingQuote.replacing(in: trailingPunct.replacing(in: raw, with: ""), with: "")
        var words = stripped.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { $0.isWhitespace }).map(String.init)
        while let f = words.first, genericWords.contains(f.lowercased()) { words.removeFirst() }
        while let l = words.last, genericWords.contains(l.lowercased()) { words.removeLast() }
        let name = words.joined(separator: " ")
        if name.isEmpty || words.count > 4 || name.utf16.count > 40 || atOrDigit.test(name) { return nil }
        return name
    }

    private static let secondLevel: Set<String> = ["co", "com", "org", "net", "ac", "gov", "edu"]

    /// Registrable domain without a public suffix list: the last two labels, or three under a short second level (example.co.uk).
    public static func registrableDomain(_ host: String) -> String {
        var h = host.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if h.hasSuffix(".") { h.removeLast() }
        let labels = h.split(separator: ".", omittingEmptySubsequences: true).map(String.init)
        if labels.count <= 2 { return labels.joined(separator: ".") }
        let tld = labels[labels.count - 1]
        let second = labels[labels.count - 2]
        let take = tld.utf16.count == 2 && secondLevel.contains(second) ? 3 : 2
        return labels.suffix(take).joined(separator: ".")
    }

    public static func senderDomain(of address: String) -> String {
        guard let at = address.lastIndex(of: "@") else { return "" }
        return registrableDomain(String(address[address.index(after: at)...]))
    }

    private static func serviceFromSender(_ fromName: String?, _ fromAddress: String) -> String {
        let noiseless = spaces.replacing(in: senderNoise.replacing(in: fromName ?? "", with: " "), with: " ")
        if let named = cleanService(noiseless) { return named }
        let label = senderDomain(of: fromAddress).split(separator: ".", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return label.isEmpty ? "Unknown" : String(label.prefix(1)).uppercased() + label.dropFirst()
    }

    private static func serviceFromSubject(_ subject: String) -> String? {
        if let r = findReversed(subject) { return cleanService(r.service) }
        return subjectLead.first(in: subject).flatMap { cleanService($0[1] ?? "") }
    }

    // MARK: Entry point

    public func detect(_ input: DetectInput) -> DetectedCode? {
        let subject = Self.spaces.replacing(in: input.subject, with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        func resolve(_ token: String) -> DetectedCode {
            DetectedCode(code: token, service: Self.serviceFromSubject(subject) ?? Self.serviceFromSender(input.fromName, input.fromAddress))
        }

        if let hit = Self.findReversed(subject)?.hit ?? Self.findInline(subject) { return resolve(hit.token) }

        var bodies: [String] = []
        if let text = input.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { bodies.append(text) }
        if let html = input.html, !html.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { bodies.append(htmlToText(String(html.prefix(200_000)))) }
        for body in bodies {
            if body.utf16.count > Self.maxBodyChars { continue }
            let meeting = Self.meetingInvite.test(body)
            let lines = Self.bodyLines(body)
            for line in lines { if let hit = Self.findInline(line, meeting: meeting) { return resolve(hit.token) } }
            if let hit = Self.findAfterCueLine(lines, meeting: meeting) { return resolve(hit.token) }
        }
        return nil
    }
}
