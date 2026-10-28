// Charset conversion for downloaded text parts. The transport has already removed the transfer encoding.

import Foundation
#if canImport(CoreFoundation)
import CoreFoundation
#endif

public enum TextDecoding {
    /// Largest slice of one text part that is decoded.
    public static let maxPartBytes = 4 * 1024 * 1024

    public static func encoding(forCharset name: String?) -> String.Encoding? {
        guard let name = name?.trimmingCharacters(in: CharacterSet(charactersIn: "\"' \t")), !name.isEmpty else { return nil }
        let cf = CFStringConvertIANACharSetNameToEncoding(name as CFString)
        guard cf != kCFStringEncodingInvalidId else { return nil }
        return String.Encoding(rawValue: CFStringConvertEncodingToNSStringEncoding(cf))
    }

    /// Declared charset first, then the encodings real-world mail falls back to. Never fails: bad bytes become U+FFFD.
    public static func decode(_ data: Data, charset: String?) -> String {
        let bytes = data.count > maxPartBytes ? data.prefix(maxPartBytes) : data
        if let declared = encoding(forCharset: charset), let text = String(data: bytes, encoding: declared) { return stripBOM(text) }
        for fallback in [String.Encoding.utf8, .windowsCP1252, .isoLatin1] {
            if let text = String(data: bytes, encoding: fallback) { return stripBOM(text) }
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    private static func stripBOM(_ text: String) -> String {
        text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
    }
}
