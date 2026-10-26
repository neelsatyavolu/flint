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

    public init(
        get: @escaping @Sendable (URL) async throws -> HTTPResponse,
        postForm: @escaping @Sendable (URL, [String: String]) async throws -> HTTPResponse
    ) {
        self.get = get
        self.postForm = postForm
    }
}

/// `application/x-www-form-urlencoded` body with keys sorted, so requests are reproducible.
public func formEncode(_ params: [String: String]) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    func escape(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: allowed) ?? "" }
    return params.sorted { $0.key < $1.key }.map { "\(escape($0.key))=\(escape($0.value))" }.joined(separator: "&")
}

extension HTTPClient {
    /// URLSession with no cookies, cache or credential storage.
    public static let live: HTTPClient = {
        let config = URLSessionConfiguration.ephemeral
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: config)

        @Sendable func run(_ request: URLRequest) async throws -> HTTPResponse {
            let (data, response) = try await session.data(for: request)
            return HTTPResponse(status: (response as? HTTPURLResponse)?.statusCode ?? 0, body: data)
        }
        return HTTPClient(
            get: { url in try await run(URLRequest(url: url)) },
            postForm: { url, params in
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                request.httpBody = Data(formEncode(params).utf8)
                return try await run(request)
            })
    }()
}
