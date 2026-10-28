// Encoders for building RFC 5322 / MIME messages: header folding, RFC 2047 encoded words, RFC 2231 parameters,
// quoted-printable and base64 bodies.

import FlintModel
import Foundation

public enum MimeEncoding {
    static let crlf = "\r\n"

    static func isASCII(_ text: String) -> Bool { text.utf8.allSatisfy { $0 < 0x80 } }

    // MARK: Headers

    /// `Name: value`, folded at whitespace so no line passes 76 characters where the value allows it.
    public static func foldedHeader(_ name: String, _ value: String) -> String {
        var lines: [String] = []
        var line = "\(name):"
        // A value may already hold CRLF SP separators (adjacent encoded words): treat them as ordinary spaces.
        let words = value.replacingOccurrences(of: "\r\n ", with: " ").split(separator: " ", omittingEmptySubsequences: true)
        for word in words {
            if line.count + 1 + word.count > 76 {
                lines.append(line)
                line = " " + word
            } else {
                line += " " + word
            }
        }
        lines.append(line)
        return lines.joined(separator: crlf)
    }

    /// RFC 2047 B-encoded words for text that is not ASCII; ASCII text is returned as is. Every word is at most 75 characters.
    public static func encodedWords(_ text: String) -> String {
        guard !isASCII(text) else { return text }
        var words: [String] = []
        var chunk = Data()
        func flush() {
            guard !chunk.isEmpty else { return }
            words.append("=?UTF-8?B?\(chunk.base64EncodedString())?=")
            chunk = Data()
        }
        for scalar in text.unicodeScalars {
            let bytes = Data(String(scalar).utf8)
            if chunk.count + bytes.count > 45 { flush() }
            chunk.append(bytes)
        }
        flush()
        return words.joined(separator: crlf + " ")
    }

    private static let specials = CharacterSet(charactersIn: "()<>[]:;@\\,.\"")

    /// A display name as it goes into an address header.
    static func phrase(_ name: String) -> String {
        if name.isEmpty { return "" }
        if !isASCII(name) { return encodedWords(name) }
        if name.unicodeScalars.contains(where: { specials.contains($0) }) {
            let escaped = name.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            return "\"\(escaped)\""
        }
        return name
    }

    public static func addressHeaderValue(_ addresses: [Address]) -> String {
        addresses.map { address in
            let name = address.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let phrase = phrase(name)
            return phrase.isEmpty ? address.address : "\(phrase) <\(address.address)>"
        }.joined(separator: ", ")
    }

    /// A header value with line breaks and control characters removed, so a subject can never inject another header.
    static func sanitizedValue(_ value: String) -> String {
        String(String.UnicodeScalarView(value.unicodeScalars.map { $0.value < 0x20 || $0.value == 0x7f ? " " : $0 }))
            .trimmingCharacters(in: .whitespaces)
    }

    /// A Content-Type or Content-Disposition parameter. Non-ASCII values go out as RFC 2047 encoded words inside the quotes (what
    /// nodemailer, Gmail and Apple Mail write and every mail client reads) rather than RFC 2231 `name*=`, which several IMAP
    /// servers and libraries (SwiftMail among them) do not decode.
    static func parameter(_ name: String, _ value: String) -> String {
        let clean = sanitizedValue(value)
        let text = isASCII(clean) ? clean : encodedWords(clean).replacingOccurrences(of: crlf + " ", with: " ")
        let quoted = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "\(name)=\"\(quoted)\""
    }

    // MARK: Bodies

    /// "7bit" when the text can go as is, else "quoted-printable".
    static func transferEncoding(for text: String) -> String {
        let ascii = text.utf8.allSatisfy { $0 < 0x80 && $0 != 0 }
        let shortLines = text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" }).allSatisfy { $0.utf8.count <= 900 }
        return ascii && shortLines && !text.contains("\r\n.") ? "7bit" : "quoted-printable"
    }

    /// Normalizes line endings to CRLF.
    static func crlfText(_ text: String) -> String {
        text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n").replacingOccurrences(of: "\n", with: crlf)
    }

    public static func quotedPrintable(_ text: String) -> String {
        let hex = Array("0123456789ABCDEF")
        var out: [String] = []
        for rawLine in crlfText(text).components(separatedBy: crlf) {
            var line = ""
            let bytes = Array(rawLine.utf8)
            var encoded: [String] = []
            for (index, byte) in bytes.enumerated() {
                let isLast = index == bytes.count - 1
                let isSpace = byte == 0x20 || byte == 0x09
                if (byte >= 33 && byte <= 126 && byte != 0x3D) || (isSpace && !isLast) {
                    encoded.append(String(UnicodeScalar(byte)))
                } else {
                    encoded.append("=\(hex[Int(byte >> 4)])\(hex[Int(byte & 0xF)])")
                }
            }
            for piece in encoded {
                if line.count + piece.count > 75 {
                    out.append(line + "=")
                    line = ""
                }
                line += piece
            }
            out.append(line)
        }
        return out.joined(separator: crlf)
    }

    public static func base64Lines(_ data: Data) -> String {
        data.base64EncodedString(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed])
    }
}
