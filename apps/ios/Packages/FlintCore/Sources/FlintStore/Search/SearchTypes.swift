// Structured form of a search string (SPEC section 4). Never contains raw user input that SQL could misread.

import Foundation

struct SearchTerm: Hashable, Sendable {
    var text: String
    var phrase: Bool
    var negated: Bool
}

struct SearchFilter: Hashable, Sendable {
    var value: String
    var negated: Bool
}

struct ParsedSearch: Hashable, Sendable {
    /// Bare words and quoted phrases, in order.
    var terms: [SearchTerm] = []
    var from: [SearchFilter] = []
    var to: [SearchFilter] = []
    var cc: [SearchFilter] = []
    var subject: [SearchFilter] = []
    /// inbox, sent, drafts, trash, spam, archive or a folder name.
    var `in`: [SearchFilter] = []
    /// Account email or id.
    var account: [SearchFilter] = []
    /// False when written as -has:attachment.
    var hasAttachment: Bool?
    /// is:unread is true, is:read is false.
    var unread: Bool?
    var pinned: Bool?
    var snoozed: Bool?
    /// Epoch ms, start of that local day (exclusive).
    var before: Int?
    /// Epoch ms, start of that local day (inclusive).
    var after: Int?
}
