import Foundation
import Testing
@testable import FlintMail

/// Answers every request with a 307 to `https://192.168.1.1/apply` and records each URL it sees.
private final class RedirectingProtocol: URLProtocol, @unchecked Sendable {
    static let seen = RequestLog()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let url = request.url!
        Self.seen.add(url)
        if url.host == "list.example.com" {
            let target = URL(string: "https://192.168.1.1/apply")!
            let response = HTTPURLResponse(url: url, statusCode: 307, httpVersion: nil, headerFields: ["Location": target.absoluteString])!
            client?.urlProtocol(self, wasRedirectedTo: URLRequest(url: target), redirectResponse: response)
            // When the session declines the redirect, this is the answer the caller gets.
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        } else {
            let ok = HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!
            client?.urlProtocol(self, didReceive: ok, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}

private final class RequestLog: @unchecked Sendable {
    private let lock = NSLock()
    private var urls: [URL] = []
    func add(_ url: URL) { lock.lock(); urls.append(url); lock.unlock() }
    var all: [URL] { lock.lock(); defer { lock.unlock() }; return urls }
}

@Suite("HTTP client redirects", .serialized)
struct HTTPClientRedirectTests {
    @Test func theOneClickPostStopsAtARedirectAndReportsIt() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RedirectingProtocol.self]
        let client = HTTPClient.makeLive(configuration: config)

        let response = try await client.postFormWithoutRedirects(URL(string: "https://list.example.com/u")!, ["List-Unsubscribe": "One-Click"])

        #expect(response.status == 307)
        #expect(RedirectingProtocol.seen.all.map(\.host) == ["list.example.com"])
    }

    @Test func aClientBuiltWithoutTheOptionFallsBackToItsOrdinaryPost() async throws {
        let client = HTTPClient(get: { _ in HTTPResponse(status: 404, body: Data()) }, postForm: { _, _ in HTTPResponse(status: 200, body: Data()) })
        #expect(try await client.postFormWithoutRedirects(URL(string: "https://x.example")!, [:]).status == 200)
    }
}
