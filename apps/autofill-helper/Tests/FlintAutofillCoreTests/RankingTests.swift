import XCTest
@testable import FlintAutofillCore

final class RankingTests: XCTestCase {
    private func code(_ id: String, _ domain: String, received: Double, expires: Double = 10_000) -> HelperCode {
        HelperCode(id: id, code: "123456", service: id, senderDomain: domain, receivedAt: received, expiresAt: expires)
    }
    func testNewestFirstAndExpiredDropped() {
        let ranked = CodeRanking.rank([code("a", "a.com", received: 1), code("b", "b.com", received: 3), code("c", "c.com", received: 2, expires: 50)], now: 100, pageHost: nil)
        XCTAssertEqual(ranked.map(\.id), ["b", "a"])
    }
    func testHostMatchFirst() {
        let ranked = CodeRanking.rank([code("new", "github.com", received: 5), code("old", "mail.kayak.com", received: 1)], now: 0, pageHost: "www.kayak.com")
        XCTAssertEqual(ranked.map(\.id), ["old", "new"])
    }
    func testHostParsingAndMatching() {
        XCTAssertEqual(CodeRanking.host(ofURL: "https://www.Kayak.com/login?x=1"), "kayak.com")
        XCTAssertNil(CodeRanking.host(ofURL: "not a url"))
        XCTAssertNil(CodeRanking.host(ofURL: nil))
        XCTAssertTrue(CodeRanking.matches(senderDomain: "accounts.example.co.uk", pageHost: "login.example.co.uk"))
        XCTAssertFalse(CodeRanking.matches(senderDomain: "evil-kayak.com", pageHost: "kayak.com"))
        XCTAssertFalse(CodeRanking.matches(senderDomain: "other.co.uk", pageHost: "example.co.uk"))
        XCTAssertFalse(CodeRanking.matches(senderDomain: "", pageHost: "kayak.com"))
    }
    func testKeystrokes() {
        XCTAssertEqual(TypingPlan.keystrokes(for: "53 03-1"), ["5", "3", "0", "3", "-", "1"])
    }
}
