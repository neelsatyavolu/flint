import Foundation

public enum CodeRanking {
    /// Host of a page URL or AXDocument string, lowercased, without a leading "www.". Nil when there is none.
    public static func host(ofURL url: String?) -> String? {
        guard let url, let h = URLComponents(string: url)?.host?.lowercased(), !h.isEmpty else { return nil }
        return h.hasPrefix("www.") ? String(h.dropFirst(4)) : h
    }

    static let secondLevel: Set<String> = ["co", "com", "org", "net", "gov", "ac", "edu"]

    /// Registrable domain, approximately: last two labels, or three for names like example.co.uk.
    static func base(_ host: String) -> String {
        let labels = host.lowercased().split(separator: ".").map(String.init)
        guard labels.count > 2 else { return labels.joined(separator: ".") }
        let n = secondLevel.contains(labels[labels.count - 2]) && labels[labels.count - 1].count == 2 ? 3 : 2
        return labels.suffix(n).joined(separator: ".")
    }

    public static func matches(senderDomain: String, pageHost: String) -> Bool {
        let s = senderDomain.lowercased(), p = pageHost.lowercased()
        return !s.isEmpty && !p.isEmpty && base(s) == base(p)
    }

    /// Drops expired codes, puts codes whose sender matches the page host first, newest first within each group.
    public static func rank(_ codes: [HelperCode], now: Double, pageHost: String?) -> [HelperCode] {
        let live = codes.filter { $0.expiresAt > now }
        let sorted = live.enumerated().sorted { a, b in
            if a.element.receivedAt != b.element.receivedAt { return a.element.receivedAt > b.element.receivedAt }
            return a.offset < b.offset
        }.map(\.element)
        guard let host = pageHost else { return sorted }
        return sorted.filter { matches(senderDomain: $0.senderDomain, pageHost: host) } + sorted.filter { !matches(senderDomain: $0.senderDomain, pageHost: host) }
    }
}

public enum TypingPlan {
    /// One entry per keystroke. Characters are typed one at a time so React/Vue inputs see real input events and split boxes auto-advance.
    public static func keystrokes(for code: String) -> [String] { code.filter { !$0.isWhitespace }.map(String.init) }
}
