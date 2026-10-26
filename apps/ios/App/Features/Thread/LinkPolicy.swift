import Foundation

/// What a tap on a link in a message does. A link whose text names one site but whose address goes to another is held
/// behind a confirmation, the classic phishing tell.
enum LinkPolicy {
    enum Decision: Equatable {
        /// A `mailto:` link: open the composer to this address.
        case compose(address: String)
        case open(URL)
        /// The text shows `shown` but the link goes to `url`.
        case confirm(URL, shown: String)
        case ignore
    }

    static func decide(href: String, text: String) -> Decision {
        let trimmed = href.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() else { return .ignore }
        if scheme == "mailto" {
            let address = trimmed.dropFirst("mailto:".count).split(separator: "?").first.map(String.init)?.removingPercentEncoding ?? ""
            return address.isEmpty ? .ignore : .compose(address: address)
        }
        guard scheme == "http" || scheme == "https", let host = url.host, !host.isEmpty else { return .ignore }
        if let shown = shownHost(in: text), !related(shown, host) { return .confirm(url, shown: shown) }
        return .open(url)
    }

    /// The host a link's text claims, or nil when the text is not an address.
    static func shownHost(in text: String) -> String? {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !words.isEmpty, !words.contains(where: \.isWhitespace) else { return nil }
        let candidate = words.contains("://") ? words : "https://\(words)"
        guard let host = URL(string: candidate)?.host?.lowercased(),
              host.range(of: #"^[a-z0-9.-]+\.[a-z]{2,}$"#, options: .regularExpression) != nil else { return nil }
        return host
    }

    /// Same site: equal hosts, ignoring `www.`, or one a subdomain of the other.
    static func related(_ a: String, _ b: String) -> Bool {
        let x = strip(a), y = strip(b)
        return x == y || x.hasSuffix(".\(y)") || y.hasSuffix(".\(x)")
    }

    private static func strip(_ host: String) -> String {
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }
}
