@testable import Flint
import FlintModel
import Testing

@Suite("Search text and suggestions")
struct SearchTextTests {
    private func op(_ token: String) -> SearchOperator { SearchOperator.all.first { $0.token == token }! }

    @Test("operators match the desktop list")
    func operatorList() {
        let tokens = SearchOperator.all.map(\.token)
        #expect(tokens == ["from:", "to:", "subject:", "has:attachment", "is:unread", "is:pinned", "in:", "before:", "after:", "account:"])
        #expect(SearchOperator.chips.count == 9)
    }

    @Test("the last word and its replacement")
    func lastWord() {
        #expect(SearchText.lastWord("") == "")
        #expect(SearchText.lastWord("budget fr") == "fr")
        #expect(SearchText.lastWord("budget ") == "")
        #expect(SearchText.replacingLastWord(in: "budget fr", with: "from:") == "budget from:")
    }

    @Test("a standalone chip toggles; one that needs a value is appended")
    func toggling() {
        #expect(SearchText.toggling(op("is:unread"), in: "") == "is:unread ")
        #expect(SearchText.toggling(op("is:unread"), in: "budget") == "budget is:unread ")
        #expect(SearchText.toggling(op("is:unread"), in: "budget is:unread ") == "budget ")
        #expect(SearchText.toggling(op("from:"), in: "budget") == "budget from:")
        #expect(SearchText.toggling(op("from:"), in: "budget from:") == "budget from: from:")
        #expect(SearchText.contains("has:attachment", in: "x HAS:attachment"))
    }

    @Test("searchable means non-blank")
    func searchable() {
        #expect(!SearchText.isSearchable("  "))
        #expect(SearchText.isSearchable(" a "))
    }

    @Test("operator suggestions follow the word being typed")
    func operatorSuggestions() {
        let all = SearchSuggestions.make(for: "fr", contacts: [])
        #expect(all.map(\.title) == ["from:"])
        #expect(all.first?.replacement == "from:")
        #expect(SearchSuggestions.make(for: "budget is:u", contacts: []).first?.replacement == "budget is:unread ")
        #expect(SearchSuggestions.make(for: "", contacts: []).isEmpty)
        #expect(SearchSuggestions.make(for: "from:", contacts: []).isEmpty)
    }

    @Test("in: offers folders")
    func folderValues() {
        let out = SearchSuggestions.make(for: "in:s", contacts: [])
        #expect(out.map(\.title) == ["in:sent", "in:spam"])
        #expect(out.first?.replacement == "in:sent ")
    }

    @Test("people fill from: or to: by what is being typed")
    func people() {
        let daniel = Contact(email: "daniel@x.example", name: "Daniel Reyes", score: 1)
        let bare = Contact(email: "dee@x.example", name: "", score: 1)
        #expect(SearchSuggestions.contactLookup(for: "budget da")?.key == "from")
        #expect(SearchSuggestions.contactLookup(for: "to:da")?.key == "to")
        #expect(SearchSuggestions.contactLookup(for: "to:da")?.prefix == "da")
        #expect(SearchSuggestions.contactLookup(for: "d") == nil)
        #expect(SearchSuggestions.contactLookup(for: "subject:da") == nil)
        let out = SearchSuggestions.make(for: "x to:d", contacts: [daniel, bare])
        let names = out.filter { $0.kind == .person }.map(\.title)
        #expect(names == ["Daniel Reyes", "dee@x.example"])
        #expect(out.first { $0.kind == .person }?.replacement == "x to:daniel@x.example ")
    }

    @Test("suggestions are capped")
    func capped() {
        let many = (0..<20).map { Contact(email: "p\($0)@x.example", name: "P\($0)", score: 1) }
        #expect(SearchSuggestions.make(for: "pp", contacts: many).count == SearchSuggestions.limit)
    }
}
