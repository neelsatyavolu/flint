@testable import Flint
import SwiftUI
import Testing

@Suite("Reader text size")
@MainActor
struct ReaderZoomTests {
    @Test("message text follows Dynamic Type, never smaller than the page and at most twice its size")
    func zoom() {
        #expect(ReaderWebView.zoom(for: .large) == 1)
        #expect(ReaderWebView.zoom(for: .xSmall) == 1)
        #expect(ReaderWebView.zoom(for: .xxxLarge) > 1)
        #expect(ReaderWebView.zoom(for: .accessibility3) == 2)
        #expect(ReaderWebView.zoom(for: .accessibility5) == 2)
    }
}
