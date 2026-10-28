import FlintModel
import Foundation

/// Names, sizes and counts, ported from `lib/format.ts` of the desktop app.
enum FlintFormat {
    /// Name to show for one address: the display name, else the part before the @.
    static func displayName(_ address: Address) -> String {
        let name = address.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return address.address.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? address.address
    }

    static func firstName(_ address: Address) -> String {
        let name = displayName(address)
        return name.split(whereSeparator: \.isWhitespace).first.map(String.init) ?? name
    }

    /// Sender line for a thread row. One person shows the full name; several show first names ("Carla, Rodney"), with "+N"
    /// when there are more than `max`.
    static func participants(_ list: [Address], max: Int = 3) -> String {
        var seen = Set<String>()
        let unique = list.filter { seen.insert($0.address.lowercased()).inserted }
        guard let first = unique.first else { return "" }
        if unique.count == 1 { return displayName(first) }
        let names = unique.prefix(max).map(firstName).joined(separator: ", ")
        let extra = unique.count - max
        return extra > 0 ? "\(names) +\(extra)" : names
    }

    /// "Name <address>" for recipient fields.
    static func address(_ address: Address) -> String {
        let name = address.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? address.address : "\(name) <\(address.address)>"
    }

    /// "to me, Carla".
    static func recipients(_ to: [Address], selfAddresses: [String] = []) -> String {
        let selves = Set(selfAddresses.map { $0.lowercased() })
        let names = to.map { selves.contains($0.address.lowercased()) ? "me" : firstName($0) }
        return names.isEmpty ? "" : "to \(names.joined(separator: ", "))"
    }

    /// "0 B", "512 B", "1.5 KB", "12 MB".
    static func fileSize(_ bytes: Int) -> String {
        guard bytes >= 0 else { return "0 B" }
        if bytes < 1024 { return "\(bytes) B" }
        let units = ["KB", "MB", "GB", "TB"]
        var value = Double(bytes) / 1024
        var index = 0
        while value >= 1024 && index < units.count - 1 {
            value /= 1024
            index += 1
        }
        let text = value >= 10 ? String(Int(value.rounded())) : String(format: "%.1f", value).replacingOccurrences(of: ".0", with: "")
        return "\(text) \(units[index])"
    }

    static func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
        "\(count) \(count == 1 ? one : (many ?? one + "s"))"
    }
}
