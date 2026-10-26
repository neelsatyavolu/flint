import FlintModel
import FlintReceipts
import Foundation

/// In-process stand-in for services/receipts, following the Worker's contract: Bearer installId.secret auth,
/// token uniqueness (409), cursor paging and the JSON error shape. Port of packages/core/src/receipts/fakeService.ts.
final class FakeReceiptsService: ReceiptsTransport, @unchecked Sendable {
    struct Call: Equatable { var method: String; var path: String; var auth: String? }
    struct Event {
        var id: Int
        var token: String
        var at: Int
        var kind: String = "open"
        var client: String? = "Gmail"
        var device: String? = "desktop"
        var country: String? = "US"
        var city: String? = "Austin"
        var fingerprint = "fp1"
    }

    private let lock = NSLock()
    private var _calls: [Call] = []
    private var _installs: [String: String] = [:]
    private var _messages: [String: (installId: String, tokens: [String])] = [:]
    private var _events: [Event] = []
    private var nextId = 1
    private var installSeq = 0
    private var _seenPings = 0
    private var _offline = false
    private var _forceStatus: Int?
    private var _deleteFails = false
    private var _pageLimit = 500

    var calls: [Call] { locked { _calls } }
    var installs: [String: String] { locked { _installs } }
    var messageRefs: Set<String> { locked { Set(_messages.keys) } }
    var seenPings: Int { locked { _seenPings } }
    var offline: Bool { get { locked { _offline } } set { locked { _offline = newValue } } }
    var forceStatus: Int? { get { locked { _forceStatus } } set { locked { _forceStatus = newValue } } }
    var deleteFails: Bool { get { locked { _deleteFails } } set { locked { _deleteFails = newValue } } }
    var pageLimit: Int { get { locked { _pageLimit } } set { locked { _pageLimit = newValue } } }

    private func locked<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    func clearInstalls() { locked { _installs.removeAll() } }
    func forget(ref: String) { locked { _messages[ref] = nil } }
    func tokens(for ref: String) -> [String] { locked { _messages[ref]?.tokens ?? [] } }

    @discardableResult
    func addEvent(token: String, kind: String = "open", client: String? = "Gmail") -> Int {
        locked {
            let id = nextId
            nextId += 1
            _events.append(Event(id: id, token: token, at: 1_000_000 + id, kind: kind, client: client))
            return id
        }
    }

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        try locked { try handle(request) }
    }

    private func handle(_ request: URLRequest) throws -> (Data, Int) {
        if _offline { throw URLError(.notConnectedToInternet) }
        let url = request.url!
        let method = request.httpMethod ?? "GET"
        let path = url.path
        _calls.append(Call(method: method, path: path + (url.query.map { "?\($0)" } ?? ""), auth: request.value(forHTTPHeaderField: "authorization")))
        if let forced = _forceStatus { return error(forced, "internal", "forced") }
        if path == "/v1/install" && method == "POST" {
            installSeq += 1
            let id = "inst\(installSeq)", secret = "secret\(installSeq)"
            _installs[id] = secret
            return json(201, ["installId": id, "secret": secret])
        }
        guard let installId = authenticate(request.value(forHTTPHeaderField: "authorization")) else {
            return error(401, "unauthorized", "Missing or invalid credentials.")
        }
        if path == "/v1/messages" && method == "POST" { return register(installId, request.httpBody) }
        if method == "DELETE", path.hasPrefix("/v1/messages/") {
            let ref = String(path.dropFirst("/v1/messages/".count)).removingPercentEncoding ?? ""
            guard _messages[ref]?.installId == installId else { return error(404, "not_found", "No such message.") }
            if _deleteFails { return json(202, ["ok": false, "deleted": false]) }
            _messages[ref] = nil
            return json(200, ["ok": true])
        }
        if path == "/v1/seen" && method == "POST" {
            _seenPings += 1
            return json(200, ["ok": true])
        }
        if path == "/v1/events" && method == "GET" { return listEvents(installId, url) }
        return error(404, "not_found", "No such endpoint.")
    }

    private func authenticate(_ header: String?) -> String? {
        guard let header, header.hasPrefix("Bearer ") else { return nil }
        let parts = header.dropFirst(7).split(separator: ".", maxSplits: 1).map(String.init)
        guard parts.count == 2, _installs[parts[0]] == parts[1] else { return nil }
        return parts[0]
    }

    private func register(_ installId: String, _ body: Data?) -> (Data, Int) {
        guard let body, let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
              let ref = object["ref"] as? String, !ref.isEmpty, ref.count <= 256,
              let recipients = object["recipients"] as? [[String: Any]], (1...100).contains(recipients.count) else {
            return error(400, "bad_request", "Invalid body.")
        }
        let tokens = recipients.compactMap { $0["token"] as? String }
        guard tokens.count == recipients.count, tokens.allSatisfy(ReceiptPixel.isTokenShape) else { return error(400, "bad_request", "Invalid body.") }
        let taken = Set(_messages.filter { $0.key != ref }.flatMap { $0.value.tokens })
        if tokens.contains(where: taken.contains) { return error(409, "conflict", "Token already in use.") }
        _messages[ref] = (installId, tokens)
        return json(201, ["ref": ref, "recipients": tokens.count])
    }

    private func listEvents(_ installId: String, _ url: URL) -> (Data, Int) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let after = Int(items.first { $0.name == "after" }?.value ?? "0") ?? 0
        let limit = min(Int(items.first { $0.name == "limit" }?.value ?? "500") ?? 500, _pageLimit)
        let mine = Set(_messages.values.filter { $0.installId == installId }.flatMap(\.tokens))
        let page = Array(_events.filter { $0.id > after && mine.contains($0.token) }.prefix(limit))
        let cursor = page.last.map { String($0.id) } ?? String(after)
        let events: [[String: Any]] = page.map {
            [
                "id": $0.id, "token": $0.token, "at": $0.at, "kind": $0.kind, "client": $0.client as Any? ?? NSNull(),
                "device": $0.device as Any? ?? NSNull(), "country": $0.country as Any? ?? NSNull(), "city": $0.city as Any? ?? NSNull(),
                "fingerprint": $0.fingerprint, "possiblyForwarded": false,
            ]
        }
        return json(200, ["events": events, "cursor": cursor])
    }

    private func json(_ status: Int, _ body: [String: Any]) -> (Data, Int) {
        ((try? JSONSerialization.data(withJSONObject: body)) ?? Data(), status)
    }

    private func error(_ status: Int, _ code: String, _ message: String) -> (Data, Int) {
        json(status, ["error": ["code": code, "message": message]])
    }
}
