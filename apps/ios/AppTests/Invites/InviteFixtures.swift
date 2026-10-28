@testable import Flint
import FlintModel
import Foundation

/// The desktop's calendar fixtures (packages/core/src/calendar/__fixtures__), read from disk beside this file.
enum InviteFixtures {
    static let own = ["me@example.com"]
    /// 2026-10-25 16:00 UTC, the date the desktop tests pin.
    static let now = utc(2026, 10, 25, 16)

    static func utc(_ y: Int, _ mo: Int, _ d: Int, _ h: Int = 0, _ mi: Int = 0) -> Int {
        InviteZones.utcEpoch(Wall(year: y, month: mo, day: d, hour: h, minute: mi))
    }

    static func fixture(_ name: String) -> String {
        let url = URL(fileURLWithPath: #filePath).resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("Fixtures").appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url) else { fatalError("missing fixture \(name)") }
        return String(decoding: data, as: UTF8.self)
    }

    static func parsed(_ name: String, own: [String] = own) -> ParsedInvite {
        guard let invite = InviteParser.parse(fixture(name), context: InviteParseContext(ownAddresses: own, now: now)) else {
            fatalError("fixture \(name) did not parse")
        }
        return invite
    }

    static func parse(_ ics: String, own: [String] = own) -> ParsedInvite? {
        InviteParser.parse(ics, context: InviteParseContext(ownAddresses: own, now: now))
    }
}
