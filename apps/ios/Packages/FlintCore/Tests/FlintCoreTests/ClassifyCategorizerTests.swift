import Foundation
import Testing
import FlintModel
@testable import FlintClassify

@Suite("Classify: categorizer fixtures")
struct ClassifyCategorizerTests {
    @Test func versionMatchesFixture() throws {
        #expect(try ClassifyFixtureFile.load("categorize").version == categorizerVersion)
    }

    @Test func fixtureCases() throws {
        let file = try ClassifyFixtureFile.load("categorize")
        var categorizeCount = 0
        var rollupCount = 0
        for c in file.cases {
            switch c.input["fn"]?.string {
            case "categorize":
                categorizeCount += 1
                let from = c.input["from"]?.string.map { Address(address: $0) }
                let input = CategorizeInput(
                    from: from, headers: c.input["headers"]?.stringMap ?? [:], isKnownContact: c.input["known"]?.bool ?? false,
                    subject: c.input["subject"]?.string
                )
                #expect(Categorizer.categorize(input).rawValue == c.expect.string, "\(c.name)")
            case "rollup":
                rollupCount += 1
                let messages = (c.input["messages"]?.array ?? []).map {
                    Categorizer.RollupMessage(category: $0.object?["category"]?.string.flatMap(MailCategory.init(rawValue:)), date: $0.object?["date"]?.int ?? 0)
                }
                #expect(Categorizer.rollupCategory(messages).rawValue == c.expect.string, "\(c.name)")
            case let other:
                Issue.record("unknown fn \(other ?? "nil") in \(c.name)")
            }
        }
        #expect(categorizeCount >= 30)
        #expect(rollupCount >= 1)
    }

    @Test func rollupEdgeCases() {
        #expect(Categorizer.rollupCategory([]) == .people)
        // Uncategorized (nil) counts as people.
        #expect(Categorizer.rollupCategory([.init(category: nil, date: 1), .init(category: .newsletters, date: 2)]) == .people)
        // Equal dates: the later array element wins, like the TypeScript reduce.
        #expect(Categorizer.rollupCategory([.init(category: .newsletters, date: 5), .init(category: .notifications, date: 5)]) == .notifications)
        #expect(Categorizer.rollupCategory([.init(category: .notifications, date: 9), .init(category: .newsletters, date: 5)]) == .notifications)
    }

    @Test func missingSenderIsPeople() {
        #expect(Categorizer.categorize(CategorizeInput(from: nil)) == .people)
    }

    @Test func nonASCIISenderAndSubjects() {
        // Unicode word characters must not look like machine local parts or transactional words.
        #expect(Categorizer.categorize(CategorizeInput(from: Address(address: "ｎｏｒｅｐｌｙ@example.com"))) == .people)
        #expect(Categorizer.categorize(CategorizeInput(from: Address(address: "a@b.com"), subject: "ÉreceiptÉ")) == .people)
        #expect(Categorizer.categorize(CategorizeInput(from: Address(address: "noreply@shop.jp"), subject: "ご注文の確認 領収書")) == .notifications)
    }
}

@Suite("Classify: JSRegex translation")
struct ClassifyJSRegexTests {
    @Test func asciiWordAndDigit() {
        let w = JSRegex(literal: #"^\w+\z"#)
        #expect(w.test("abc_9"))
        #expect(!w.test("café"))
        #expect(!JSRegex(literal: #"^\d+\z"#).test("１２３４"))
        #expect(JSRegex(literal: #"^\d+\z"#).test("1234"))
    }

    @Test func boundaryIsAscii() {
        // ICU \b would see no boundary between "é" and "x" the way JS does; JS treats é as a non-word char.
        #expect(JSRegex(literal: #"\bcode\b"#).test("éCODEé".lowercased()))
        #expect(!JSRegex(literal: #"\bcode\b"#).test("encode"))
    }

    @Test func classEscapesAndEndOfInput() {
        #expect(JSRegex(literal: #"[\w@]+\z"#).test("a@b"))
        #expect(JSRegex(literal: #"[a[]"#).test("["))
        #expect(!JSRegex(literal: #"x\z"#).test("x\n"))
    }

    @Test func invalidPatternIsNil() {
        #expect(JSRegex("(unclosed") == nil)
    }
}
