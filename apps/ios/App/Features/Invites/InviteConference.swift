import Foundation

/// Video call detection and description clean-up for invitations. Port of calendar/conference.ts.
enum InviteConferenceFinder {
    private static let urlEnd = #"[^\s<>"')\]]*"#
    private static let patterns: [(kind: ConferenceKind, label: String, regex: NSRegularExpression)] = [
        (.meet, "Google Meet", re(#"https?://meet\.google\.com/(?:lookup/)?[a-z0-9_-]+"# + urlEnd)),
        (.zoom, "Zoom", re(#"https?://[\w.-]*zoom\.(?:us|com|com\.cn)/(?:j|my|s|w|wc/join)/"# + urlEnd)),
        (.teams, "Microsoft Teams", re(#"https?://teams\.(?:microsoft|live)\.com/(?:l/meetup-join|meet|meetup-join)/"# + urlEnd)),
        (.webex, "Webex", re(#"https?://[\w.-]*webex\.com/(?:[\w.-]+/)*(?:meet|join|j\.php|webappng)"# + urlEnd)),
    ]
    private static let bidi = re("[\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]")

    private static func re(_ pattern: String, _ options: NSRegularExpression.Options = [.caseInsensitive]) -> NSRegularExpression {
        // The patterns are literals in this file.
        // swiftlint:disable:next force_try
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    private static func firstMatch(_ regex: NSRegularExpression, in text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        return regex.firstMatch(in: text, range: range).flatMap { Range($0.range, in: text) }.map { String(text[$0]) }
    }

    private static func capture(_ pattern: String, in text: String) -> String? {
        let regex = re(pattern)
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range), match.numberOfRanges > 1, let r = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    private static func stripBidi(_ text: String) -> String {
        bidi.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "")
    }

    private static func trimUrl(_ url: String) -> String {
        var out = url
        while let last = out.last, ".,;:!?".contains(last) { out.removeLast() }
        return out
    }

    private static func known(_ text: String) -> (kind: ConferenceKind, label: String, url: String)? {
        for pattern in patterns {
            if let hit = firstMatch(pattern.regex, in: text) { return (pattern.kind, pattern.label, trimUrl(hit)) }
        }
        return nil
    }

    private static func code(kind: ConferenceKind, url: String, description: String) -> String? {
        switch kind {
        case .meet: return capture(#"meet\.google\.com/(?:lookup/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\b"#, in: url)?.lowercased()
        case .zoom:
            let spoken = capture(#"meeting id:?\s*([\d ]{9,15})"#, in: description)?.trimmingCharacters(in: .whitespaces)
            return spoken ?? capture(#"/j/(\d{9,11})"#, in: url)
        case .teams: return capture(#"meeting id:?\s*([\d ]{9,20})"#, in: description)?.trimmingCharacters(in: .whitespaces)
        case .webex: return capture(#"(?:meeting number|access code)(?: \(access code\))?:?\s*([\d ]{8,15})"#, in: description)?.trimmingCharacters(in: .whitespaces)
        case .other: return nil
        }
    }

    private static let phoneCues = [
        "dial by your location", "join by phone", "dial[- ]?in", "one tap mobile", "phone numbers?", "tap to call",
    ]

    private static func phone(from description: String) -> String? {
        let text = stripBidi(description)
        let number = #"(\+\d[\d\s().-]{6,}\d)"#
        for cue in phoneCues {
            guard let at = re(cue).firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let start = Range(at.range, in: text) else { continue }
            if let found = capture(number, in: String(text[start.lowerBound...])) { return squash(found) }
        }
        return capture(#"\((?:US|UK|CA|AU|DE|FR|IN)\)\s*"# + number, in: text).map(squash)
    }

    private static func squash(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    struct Sources {
        var googleConference: String?
        var vendorUrls: [String?] = []
        var location: String?
        var url: String?
        var description: String?
    }

    /// The video call an invitation points at: explicit properties first, then LOCATION, URL and DESCRIPTION.
    static func find(_ src: Sources) -> InviteConference? {
        let description = stripBidi(src.description ?? "")
        let candidates = [src.googleConference] + src.vendorUrls + [src.location, src.url, description]
        for text in candidates.compactMap({ $0 }) where !text.isEmpty {
            if let hit = known(text) {
                return InviteConference(kind: hit.kind, url: hit.url, label: hit.label, code: code(kind: hit.kind, url: hit.url, description: description), phone: phone(from: description))
            }
        }
        for text in ([src.googleConference] + src.vendorUrls + [src.location]).compactMap({ $0 }) {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.lowercased().hasPrefix("http"), !trimmed.contains(where: \.isWhitespace) else { continue }
            let url = trimUrl(trimmed)
            let host = URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") ?? url
            return InviteConference(kind: .other, url: url, label: host, code: nil, phone: phone(from: description))
        }
        return nil
    }

    // MARK: Description

    private static let dropLines: [NSRegularExpression] = [
        "^invitation from google calendar", "^you are receiving this (email|message)", "^to stop receiving these emails",
        "^forwarding this invitation", "^reply for\\b", "^view all event details", "^join with google meet", "^join: ?https?:",
        "^meeting link:?", "^join by phone", "^more phone numbers", "^pin:", "^learn more about meet", "^please do not edit this section",
        "^learn more$", "^this event has a video call\\.?$", "^join the meeting now$", "^\\(?(?:us|uk|ca|au|de|fr|in)\\)?\\s*\\+\\d",
    ].map { re($0) }

    private static func matches(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    /// Removes every region from one marker line to the next (markers included) when `boilerplate` says it is generated text.
    private static func dropRegions(_ lines: [String], marker: (String) -> Bool, boilerplate: ([String]) -> Bool) -> [String] {
        var out: [String] = []
        var i = 0
        while i < lines.count {
            guard marker(lines[i]) else { out.append(lines[i]); i += 1; continue }
            let close = lines.indices.first { $0 > i && marker(lines[$0]) }
            let region = close.map { Array(lines[i...$0]) } ?? Array(lines[i...])
            if boilerplate(region) { i += region.count } else { out.append(lines[i]); i += 1 }
        }
        return out
    }

    /// Plain description text without the generated join blocks and footers. Nil when nothing meaningful is left.
    static func cleanDescription(_ raw: String?, conferenceUrl: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        var text = stripBidi(raw).replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        text = re(#"<br\s*/?>"#).stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: "\n")
        if let zoom = re(#"\n?\s*Join Zoom Meeting\b"#).firstMatch(in: text, range: NSRange(text.startIndex..., in: text)), let r = Range(zoom.range, in: text) {
            text = String(text[..<r.lowerBound])
            let intro = re(#"(inviting you to a scheduled zoom meeting|^\s*topic:|^\s*time:|^\s*hi there,?\s*$)"#)
            text = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init).filter { !matches(intro, $0) }.joined(separator: "\n")
        }
        var lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        lines = dropRegions(lines, marker: { $0.trimmingCharacters(in: .whitespaces).hasPrefix("-::~") }, boilerplate: { _ in true })
        let rule = re("^_{20,}\\s*$")
        let teams = re("microsoft teams|join (the )?meeting|meeting id|need help|webex")
        lines = dropRegions(lines, marker: { matches(rule, $0.trimmingCharacters(in: .whitespaces)) }, boilerplate: { matches(teams, $0.joined(separator: "\n")) })
        let webex = re("^join from the meeting link|^join meeting$|^join from a video (conferencing )?system")
        if let cut = lines.firstIndex(where: { matches(webex, $0.trimmingCharacters(in: .whitespaces)) }) { lines = Array(lines[..<cut]) }
        lines = lines.filter { line in
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.isEmpty { return true }
            if dropLines.contains(where: { matches($0, t) }) { return false }
            let bare = t.replacingOccurrences(of: "<", with: "").replacingOccurrences(of: ">", with: "")
            if let conferenceUrl, bare == conferenceUrl { return false }
            return !(t.lowercased().hasPrefix("http") && !t.contains(" ") && known(t) != nil)
        }
        var joined = lines.map { $0.replacingOccurrences(of: #"[ \t]+$"#, with: "", options: .regularExpression) }.joined(separator: "\n")
        joined = joined.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined
    }
}
