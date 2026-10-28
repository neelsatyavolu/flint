import Foundation

/// One content line: `NAME;PARAM=value:value`. Names and parameter names are upper case; the value is raw (escapes intact).
struct ICalProperty: Sendable {
    var name: String
    var params: [String: String]
    var value: String

    /// The value as TEXT (RFC 5545 3.3.11): `\n`, `\,`, `\;` and `\\` resolved.
    var text: String {
        var out = ""
        var escaped = false
        for ch in value {
            if escaped {
                out.append(ch == "n" || ch == "N" ? "\n" : ch)
                escaped = false
            } else if ch == "\\" {
                escaped = true
            } else {
                out.append(ch)
            }
        }
        if escaped { out.append("\\") }
        return out
    }
}

struct ICalComponent: Sendable {
    var name: String
    var properties: [ICalProperty] = []
    var children: [ICalComponent] = []

    func first(_ name: String) -> ICalProperty? { properties.first { $0.name == name } }
    func all(_ name: String) -> [ICalProperty] { properties.filter { $0.name == name } }
    func has(_ name: String) -> Bool { properties.contains { $0.name == name } }
    func components(_ name: String) -> [ICalComponent] { children.filter { $0.name == name } }
}

/// A small RFC 5545 reader: unfolds lines (at the byte level, so a fold inside a UTF-8 sequence is safe), splits parameters
/// and builds the component tree. It never throws; text that is not a calendar gives nil.
enum ICalReader {
    static func parse(_ text: String) -> ICalComponent? { parse(Data(text.utf8)) }

    static func parse(_ data: Data) -> ICalComponent? {
        let lines = unfold(data)
        var stack: [ICalComponent] = []
        var root: ICalComponent?
        for line in lines {
            guard let property = parseLine(line) else { continue }
            switch property.name {
            case "BEGIN":
                stack.append(ICalComponent(name: property.value.uppercased()))
            case "END":
                guard let done = stack.popLast() else { continue }
                if stack.isEmpty {
                    if root == nil, done.name == "VCALENDAR" { root = done }
                } else {
                    stack[stack.count - 1].children.append(done)
                }
            default:
                if !stack.isEmpty { stack[stack.count - 1].properties.append(property) }
            }
        }
        // A truncated calendar still yields what was read before the cut.
        while stack.count > 1, let open = stack.popLast() { stack[stack.count - 1].children.append(open) }
        return root ?? stack.first.flatMap { $0.name == "VCALENDAR" ? $0 : nil }
    }

    /// Joins folded lines (a CRLF, LF or CR followed by a space or tab) and drops a leading byte order mark.
    static func unfold(_ data: Data) -> [String] {
        var bytes = [UInt8](data)
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes.removeFirst(3) }
        var lines: [[UInt8]] = [[]]
        var i = 0
        while i < bytes.count {
            let b = bytes[i]
            if b == 0x0D || b == 0x0A {
                var next = i + 1
                if b == 0x0D, next < bytes.count, bytes[next] == 0x0A { next += 1 }
                if next < bytes.count, bytes[next] == 0x20 || bytes[next] == 0x09 {
                    i = next + 1
                } else {
                    lines.append([])
                    i = next
                }
                continue
            }
            lines[lines.count - 1].append(b)
            i += 1
        }
        return lines.filter { !$0.isEmpty }.map { String(decoding: $0, as: UTF8.self) }
    }

    static func parseLine(_ line: String) -> ICalProperty? {
        var name = ""
        var params: [String: String] = [:]
        var current = ""
        var paramName: String?
        var quoted = false
        var index = line.startIndex
        func finishParam() {
            guard let key = paramName else { return }
            params[key] = current
            paramName = nil
        }
        while index < line.endIndex {
            let ch = line[index]
            if quoted {
                if ch == "\"" { quoted = false } else { current.append(ch) }
            } else if ch == "\"" {
                quoted = true
            } else if ch == "=", paramName == nil, !name.isEmpty {
                paramName = current.uppercased()
                current = ""
            } else if ch == ";" {
                if name.isEmpty { name = current.uppercased() } else { finishParam() }
                current = ""
            } else if ch == ":" {
                if name.isEmpty { name = current.uppercased() } else { finishParam() }
                let value = String(line[line.index(after: index)...])
                return name.isEmpty ? nil : ICalProperty(name: name, params: params, value: value)
            } else {
                current.append(ch)
            }
            index = line.index(after: index)
        }
        return nil
    }
}
