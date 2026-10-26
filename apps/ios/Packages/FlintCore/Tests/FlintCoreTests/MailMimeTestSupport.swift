import Foundation
@testable import FlintMail

/// A small MIME reader for tests: headers (unfolded, lower-case, repeats kept), decoded bodies, multipart children.
struct MailParsedMime {
    var headers: [String: [String]]
    var contentType: String
    var parameters: [String: String]
    var parts: [MailParsedMime]
    var body: Data

    func header(_ name: String) -> String? { headers[name.lowercased()]?.first }
    var text: String { String(decoding: body, as: UTF8.self) }
    var disposition: String? { header("content-disposition")?.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } }
    var filename: String? {
        guard let value = header("content-disposition") else { return nil }
        let rest = value.split(separator: ";", maxSplits: 1).dropFirst().joined(separator: ";")
        return BodyPartTree.parseContentType("x/y;" + rest).parameters["filename"].map(mailDecodeEncodedWords)
    }

    func flatten() -> [MailParsedMime] { parts.isEmpty ? [self] : parts.flatMap { $0.flatten() } }

    static func parse(_ data: Data) -> MailParsedMime { parse(String(decoding: data, as: UTF8.self)) }

    static func parse(_ raw: String) -> MailParsedMime {
        let split = raw.range(of: "\r\n\r\n")
        let head = split.map { String(raw[..<$0.lowerBound]) } ?? raw
        let body = split.map { String(raw[$0.upperBound...]) } ?? ""
        var headers: [String: [String]] = [:]
        var current: (String, String)?
        func flush() { if let c = current { headers[c.0, default: []].append(c.1.trimmingCharacters(in: .whitespaces)) }; current = nil }
        for line in head.components(separatedBy: "\r\n") {
            if line.hasPrefix(" ") || line.hasPrefix("\t") { current?.1 += " " + line.trimmingCharacters(in: .whitespaces) }
            else if let colon = line.firstIndex(of: ":") {
                flush()
                current = (line[..<colon].lowercased(), line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces))
            }
        }
        flush()
        let type = BodyPartTree.parseContentType(headers["content-type"]?.first ?? "text/plain")
        let media = "\(type.type)/\(type.subtype)"
        if type.type == "multipart", let boundary = type.parameters["boundary"] {
            let chunks = body.components(separatedBy: "--\(boundary)")
            let parts = chunks.dropFirst().filter { !$0.hasPrefix("--") }.map { chunk -> MailParsedMime in
                var piece = chunk
                if piece.hasPrefix("\r\n") { piece.removeFirst() } // CRLF is one Character
                if piece.hasSuffix("\r\n") { piece.removeLast() }
                return parse(piece)
            }
            return MailParsedMime(headers: headers, contentType: media, parameters: type.parameters, parts: parts, body: Data())
        }
        let encoding = (headers["content-transfer-encoding"]?.first ?? "7bit").lowercased()
        var decoded: Data
        switch encoding {
        case "base64": decoded = Data(base64Encoded: body.filter { !$0.isWhitespace }) ?? Data()
        case "quoted-printable": decoded = mailDecodeQuotedPrintable(body)
        default: decoded = Data(body.utf8)
        }
        return MailParsedMime(headers: headers, contentType: media, parameters: type.parameters, parts: [], body: decoded)
    }
}

func mailDecodeQuotedPrintable(_ text: String) -> Data {
    var out = Data()
    let bytes = Array(text.utf8)
    var i = 0
    while i < bytes.count {
        if bytes[i] == 0x3D {
            if i + 2 < bytes.count + 0, bytes[i + 1] == 0x0D, bytes[i + 2] == 0x0A { i += 3; continue }
            if i + 2 < bytes.count || i + 2 == bytes.count - 0, let value = UInt8(String(decoding: bytes[(i + 1)..<min(i + 3, bytes.count)], as: UTF8.self), radix: 16) {
                out.append(value)
                i += 3
                continue
            }
        }
        out.append(bytes[i])
        i += 1
    }
    return out
}

/// Decodes RFC 2047 B-encoded words in a header value.
func mailDecodeEncodedWords(_ value: String) -> String {
    guard let regex = try? NSRegularExpression(pattern: #"=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?="#) else { return value }
    var result = ""
    var cursor = value.startIndex
    var lastWasWord = false
    for match in regex.matches(in: value, range: NSRange(value.startIndex..., in: value)) {
        guard let whole = Range(match.range, in: value), let payload = Range(match.range(at: 1), in: value) else { continue }
        let gap = String(value[cursor..<whole.lowerBound])
        if !(lastWasWord && gap.trimmingCharacters(in: .whitespaces).isEmpty) { result += gap }
        result += Data(base64Encoded: String(value[payload])).map { String(decoding: $0, as: UTF8.self) } ?? ""
        cursor = whole.upperBound
        lastWasWord = true
    }
    return result + value[cursor...]
}
