@testable import Flint
import FlintMail
import FlintModel
import Foundation
import Testing

@Suite("Error text")
struct FlintErrorTextTests {
    @Test("service messages for input, missing things and sign-in pass through")
    func passThrough() {
        #expect(FlintErrorText.message(for: FlintError(.invalid, "Enter a full email address.")) == "Enter a full email address.")
        #expect(FlintErrorText.message(for: FlintError(.notFound, "That account no longer exists.")) == "That account no longer exists.")
        #expect(FlintErrorText.message(for: FlintError(.auth, "Sign in again.")) == "Sign in again.")
    }

    @Test("connection and internal failures never show library text")
    func fixed() {
        let leaky = "NIOConnectionError: imap.example.com:993 A1 LOGIN me@example.com"
        for code in [FlintErrorCode.network, .internal] {
            let text = FlintErrorText.message(for: FlintError(code, leaky))
            #expect(!text.contains("imap.example.com") && !text.contains("LOGIN") && !text.contains("me@example.com"))
        }
        #expect(FlintErrorText.message(for: FlintError(.network, "x")) == "Couldn't connect. Check your connection and try again.")
        #expect(FlintErrorText.message(for: URLError(.badURL)) == "Something went wrong. Try again.")
    }

    @Test("an empty message falls back by code and long ones are clipped")
    func fallbackAndClip() {
        #expect(FlintErrorText.message(for: FlintError(.notFound, "  ")) == "That item no longer exists.")
        let long = String(repeating: "word ", count: 80)
        #expect(FlintErrorText.message(for: FlintError(.invalid, long)).count <= 160)
    }

    @Test("every code has fallback text without exclamation marks")
    func allCodes() {
        let codes: [FlintErrorCode] = [.notFound, .invalid, .auth, .network, .permission, .conflict, .aiNotConnected, .internal]
        for code in codes {
            let text = FlintErrorText.fallback(code)
            #expect(!text.isEmpty && !text.contains("!"))
        }
    }

    @Test("closing the Google sheet is silent, real failures are not")
    func silent() {
        #expect(FlintErrorText.isSilent(FlintError.googleSignInCancelled))
        #expect(FlintErrorText.isSilent(CancellationError()))
        #expect(!FlintErrorText.isSilent(FlintError(.auth, "Google sign-in failed.")))
    }
}
