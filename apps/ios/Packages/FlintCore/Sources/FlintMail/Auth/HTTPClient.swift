// Injectable HTTP for the auth and autoconfig code (track 2C). Tests script it; the app uses `.live`.
// Never log request bodies: token requests carry codes and refresh tokens.

import FlintModel
import Foundation

public struct HTTPResponse: Sendable {
    public var status: Int
    public var body: Data

    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

public struct HTTPClient: Sendable {
    public var get: @Sendable (URL) async throws -> HTTPResponse
    public var postForm: @Sendable (URL, [String: String]) async throws -> HTTPResponse
    /// Like `postForm`, but a 3xx answer is returned as it is and never followed (RFC 8058 one-click unsubscribe).
    public var postFormWithoutRedirects: @Sendable (URL, [String: String]) async throws -> HTTPResponse

    public init(
        get: @escaping @Sendable (URL) async throws -> HTTPResponse,
        postForm: @escaping @Sendable (URL, [String: String]) async throws -> HTTPResponse,
        postFormWithoutRedirects: (@Sendable (URL, [String: String]) async throws -> HTTPResponse)? = nil
    ) {
        self.get = get
        self.postForm = postForm
        self.postFormWithoutRedirects = postFormWithoutRedirects ?? postForm
    }
}

/// `application/x-www-form-urlencoded` body with keys sorted, so requests are reproducible.
public func formEncode(_ params: [String: String]) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    func escape(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
    return params.sorted { $0.key < $1.key }.map { "\(escape($0.key))=\(escape($0.value))" }.joined(separator: "&")
}

/// Refuses every redirect, so the 3xx response itself comes back to the caller.
private final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? { nil }
}

extension HTTPClient {
    /// URLSession with no cookies, cache or credential storage.
    public static let live: HTTPClient = makeLive(configuration: .ephemeral)

    static func makeLive(configuration config: URLSessionConfiguration) -> HTTPClient {
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: config)

        @Sendable func run(_ request: URLRequest, followRedirects: Bool) async throws -> HTTPResponse {
            let (data, response) = followRedirects
                ? try await session.data(for: request)
                : try await session.data(for: request, delegate: NoRedirects())
            return HTTPResponse(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: data)
        }
        @Sendable func formPost(_ url: URL, _ params: [String: String]) -> URLRequest {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(formEncode(params).utf8)
            return request
        }
        return HTTPClient(
            get: { url in try await run(URLRequest(url: url), followRedirects: true) },
            postForm: { url, params in try await run(formPost(url, params), followRedirects: true) },
            postFormWithoutRedirects: { url, params in try await run(formPost(url, params), followRedirects: false) })
    }
}
