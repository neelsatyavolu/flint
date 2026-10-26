import FlintModel
import Foundation

/// The network seam: tests substitute a fake service, the app uses URLSession.
public protocol ReceiptsTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

public struct URLSessionReceiptsTransport: ReceiptsTransport {
    private let session: URLSession

    public init() {
        let config = URLSessionConfiguration.ephemeral
        config.waitsForConnectivity = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        session = URLSession(configuration: config)
    }

    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

/// The service answered with a non-2xx status.
struct ServiceHTTPError: Error {
    var status: Int
    var code: String
    var message: String
}

struct CallOptions: Sendable {
    var transport: any ReceiptsTransport
    var baseURL: String
    var timeout: TimeInterval
    var bearer: String?
}

enum ReceiptsHTTP {
    /// One JSON call. Throws `ServiceHTTPError` for HTTP errors and `FlintError(.network)` for transport or shape problems.
    static func call<Response: Decodable>(
        _ options: CallOptions, method: String, path: String, body: (any Encodable & Sendable)? = nil, as type: Response.Type
    ) async throws -> Response {
        guard let url = URL(string: options.baseURL + path) else { throw FlintError(.invalid, "Read receipts need a valid service address.") }
        var request = URLRequest(url: url, timeoutInterval: options.timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "accept")
        if let bearer = options.bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let data: Data
        let status: Int
        do {
            (data, status) = try await options.transport.send(request)
        } catch {
            throw FlintError(.network, "Couldn't reach the receipts service.")
        }
        guard (200..<300).contains(status) else {
            let parsed = try? JSONDecoder().decode(ReceiptsWire.ErrorResponse.self, from: data)
            throw ServiceHTTPError(status: status, code: parsed?.error.code ?? "unknown", message: parsed?.error.message ?? "HTTP \(status)")
        }
        do {
            return try JSONDecoder().decode(Response.self, from: data)
        } catch {
            throw FlintError(.network, "The receipts service sent an unexpected reply.")
        }
    }
}

private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
