// Search string parser. Ported from packages/core/src/search/parse.ts; shared fixture: search.json.
// Never fails: anything it cannot understand (unknown operators, bad dates, empty values) stays a plain search term.

import Foundation

enum SearchParser {
    private static let maxInput = 500
    private static let maxTokens = 40

    private struct RawToken {
        var text: String
        var quoted: Bool
        var minus: Bool
    }

    /// Splits on whitespace, keeping "quoted phrases" (also after key: and a leading minus) together. Unterminated quotes run to the end.
    private static func tokenize(_ input: [Character]) -> [RawToken] {
        var tokens: [RawToken] = []
        var i = 0
        while i < input.count && tokens.count < maxTokens {
            while i < input.count && input[i].isWhitespace { i += 1 }
            if i >= input.count { break }
            var text = ""
            var quoted = false
            let minus = input[i] == "-"
            if minus { i += 1 }
            while i < input.count && !input[i].isWhitespace {
                if input[i] == "\"" {
                    quoted = true
                    i += 1
                    while i < input.count && input[i] != "\"" { text.append(input[i]); i += 1 }
                    i += 1
                } else {
                    text.append(input[i])
                    i += 1
                }
            }
            tokens.append(RawToken(text: text, quoted: quoted, minus: minus))
        }
        return tokens
    }

    /// Local-midnight epoch ms for YYYY-MM-DD, or nil when the string is not a real date.
    static func parseDay(_ value: String, calendar: Calendar = .current) -> Int? {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4,
              (1...2).contains(parts[1].count), (1...2).contains(parts[2].count),
              parts.allSatisfy({ $0.allSatisfy { ("0"..."9").contains($0) } }),
              let y = Int(parts[0]), let mo = Int(parts[1]), let d = Int(parts[2]),
              let date = calendar.date(from: DateComponents(year: y, month: mo, day: d))
        else { return nil }
        let back = calendar.dateComponents([.year, .month, .day], from: date)
        guard back.year == y, back.month == mo, back.day == d else { return nil }
        return Int((date.timeIntervalSince1970 * 1000).rounded())
    }

    static func parse(_ input: String, calendar: Calendar = .current) -> ParsedSearch {
        var out = ParsedSearch()
        var terms: [SearchTerm] = []
        for raw in tokenize(Array(input.prefix(maxInput))) {
            let negated = raw.minus && !raw.text.isEmpty
            let body = raw.minus && !negated ? "-" : raw.text
            if body.isEmpty { continue }
            if !applyOperator(&out, body, negated, calendar) {
                terms.append(SearchTerm(text: body, phrase: raw.quoted && body.contains(where: \.isWhitespace), negated: negated))
            }
        }
        out.terms = terms
        return out
    }

    private static func applyOperator(_ out: inout ParsedSearch, _ body: String, _ negated: Bool, _ calendar: Calendar) -> Bool {
        guard let colon = body.firstIndex(of: ":"), colon != body.startIndex else { return false }
        let key = body[..<colon].lowercased()
        let value = body[body.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return false }
        let lower = value.lowercased()

        switch key {
        case "from": out.from.append(SearchFilter(value: value, negated: negated))
        case "to": out.to.append(SearchFilter(value: value, negated: negated))
        case "cc": out.cc.append(SearchFilter(value: value, negated: negated))
        case "subject": out.subject.append(SearchFilter(value: value, negated: negated))
        case "in": out.in.append(SearchFilter(value: lower, negated: negated))
        case "account": out.account.append(SearchFilter(value: lower, negated: negated))
        case "has":
            guard lower == "attachment" || lower == "attachments" else { return false }
            out.hasAttachment = !negated
        case "is":
            switch lower {
            case "unread", "read": out.unread = (lower == "unread") != negated
            case "pinned": out.pinned = !negated
            case "snoozed": out.snoozed = !negated
            default: return false
            }
        case "before", "after":
            guard !negated, let day = parseDay(value, calendar: calendar) else { return false }
            if key == "before" { out.before = day } else { out.after = day }
        default: return false
        }
        return true
    }
}
