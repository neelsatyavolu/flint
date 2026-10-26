import Foundation

/// Wire protocol with Flint's main process, version 1. Mirrors packages/core/src/autofill/contract.ts: one JSON
/// object per line, commands arrive on stdin (field "op"), events leave on stdout (field "event").
public let protocolVersion = 1

public struct ScreenRect: Codable, Equatable {
    public var x: Double, y: Double, width: Double, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) { self.x = x; self.y = y; self.width = width; self.height = height }
}

public struct HelperCode: Codable, Equatable {
    public var id: String
    public var code: String
    public var service: String
    public var senderDomain: String
    public var receivedAt: Double
    public var expiresAt: Double
    public init(id: String, code: String, service: String, senderDomain: String, receivedAt: Double, expiresAt: Double) {
        self.id = id; self.code = code; self.service = service; self.senderDomain = senderDomain; self.receivedAt = receivedAt; self.expiresAt = expiresAt
    }
}

public enum Command: Equatable {
    case status
    case requestPermission(openPane: Bool)
    case codes([HelperCode])
    case typeNewest
    case demo(field: ScreenRect, code: String, service: String)
    case demoStop
    case shutdown
}

public enum FillVia: String, Codable { case suggestion, shortcut, demo }
public enum FillMethod: String, Codable { case typed, ax_value }
public enum FillFailure: String, Codable { case no_focus, secure_input, screen_locked, no_permission, type_failed, expired }

public enum Event: Equatable {
    case ready(protocol: Int, version: String, pid: Int, trusted: Bool)
    case permission(trusted: Bool)
    case used(codeId: String, via: FillVia, method: FillMethod)
    case fillFailed(codeId: String, reason: FillFailure)
    case observing(active: Bool)
    case error(message: String)
}

public enum ProtocolError: Error, Equatable { case notJSON, unknownOp(String), malformed(String) }

private struct Envelope: Decodable { var op: String?; var event: String? }

// MARK: - Commands (decode) and events (encode); the reverse directions exist for tests.

extension Command: Codable {
    private enum K: String, CodingKey { case op, openPane, codes, field, code, service }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        let op = try c.decode(String.self, forKey: .op)
        switch op {
        case "status": self = .status
        case "request_permission": self = .requestPermission(openPane: try c.decode(Bool.self, forKey: .openPane))
        case "codes": self = .codes(try c.decode([HelperCode].self, forKey: .codes))
        case "type_newest": self = .typeNewest
        case "demo": self = .demo(field: try c.decode(ScreenRect.self, forKey: .field), code: try c.decode(String.self, forKey: .code), service: try c.decode(String.self, forKey: .service))
        case "demo_stop": self = .demoStop
        case "shutdown": self = .shutdown
        default: throw ProtocolError.unknownOp(op)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        switch self {
        case .status: try c.encode("status", forKey: .op)
        case .requestPermission(let openPane): try c.encode("request_permission", forKey: .op); try c.encode(openPane, forKey: .openPane)
        case .codes(let codes): try c.encode("codes", forKey: .op); try c.encode(codes, forKey: .codes)
        case .typeNewest: try c.encode("type_newest", forKey: .op)
        case .demo(let field, let code, let service): try c.encode("demo", forKey: .op); try c.encode(field, forKey: .field); try c.encode(code, forKey: .code); try c.encode(service, forKey: .service)
        case .demoStop: try c.encode("demo_stop", forKey: .op)
        case .shutdown: try c.encode("shutdown", forKey: .op)
        }
    }
}

extension Event: Codable {
    private enum K: String, CodingKey { case event, `protocol`, version, pid, trusted, codeId, via, method, reason, active, message }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: K.self)
        switch try c.decode(String.self, forKey: .event) {
        case "ready": self = .ready(protocol: try c.decode(Int.self, forKey: .protocol), version: try c.decode(String.self, forKey: .version), pid: try c.decode(Int.self, forKey: .pid), trusted: try c.decode(Bool.self, forKey: .trusted))
        case "permission": self = .permission(trusted: try c.decode(Bool.self, forKey: .trusted))
        case "used": self = .used(codeId: try c.decode(String.self, forKey: .codeId), via: try c.decode(FillVia.self, forKey: .via), method: try c.decode(FillMethod.self, forKey: .method))
        case "fill_failed": self = .fillFailed(codeId: try c.decode(String.self, forKey: .codeId), reason: try c.decode(FillFailure.self, forKey: .reason))
        case "observing": self = .observing(active: try c.decode(Bool.self, forKey: .active))
        case "error": self = .error(message: try c.decode(String.self, forKey: .message))
        case let other: throw ProtocolError.unknownOp(other)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        switch self {
        case .ready(let p, let v, let pid, let t): try c.encode("ready", forKey: .event); try c.encode(p, forKey: .protocol); try c.encode(v, forKey: .version); try c.encode(pid, forKey: .pid); try c.encode(t, forKey: .trusted)
        case .permission(let t): try c.encode("permission", forKey: .event); try c.encode(t, forKey: .trusted)
        case .used(let id, let via, let m): try c.encode("used", forKey: .event); try c.encode(id, forKey: .codeId); try c.encode(via, forKey: .via); try c.encode(m, forKey: .method)
        case .fillFailed(let id, let r): try c.encode("fill_failed", forKey: .event); try c.encode(id, forKey: .codeId); try c.encode(r, forKey: .reason)
        case .observing(let a): try c.encode("observing", forKey: .event); try c.encode(a, forKey: .active)
        case .error(let m): try c.encode("error", forKey: .event); try c.encode(m, forKey: .message)
        }
    }
}

public enum Wire {
    /// Parses one stdin line into a command. Throws ProtocolError for junk; the caller reports a length, never the line (it can hold a code).
    public static func decodeCommand(_ line: String) throws -> Command {
        guard let data = line.data(using: .utf8), (try? JSONSerialization.jsonObject(with: data)) != nil else { throw ProtocolError.notJSON }
        do { return try JSONDecoder().decode(Command.self, from: data) }
        catch let e as ProtocolError { throw e }
        catch { throw ProtocolError.malformed(String(describing: type(of: error))) }
    }

    /// One stdout line, newline included. Keys are sorted so output is stable.
    public static func encodeLine(_ event: Event) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = (try? encoder.encode(event)) ?? Data("{\"event\":\"error\",\"message\":\"encode failed\"}".utf8)
        return String(decoding: data, as: UTF8.self) + "\n"
    }
}
