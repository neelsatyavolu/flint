import FlintModel

/// The fictional cast. Names are invented and every domain is reserved for examples (RFC 2606) or ends in `.example`.
enum DemoPeople {
    static let mayaGoogle = Address(name: "Maya Okafor", address: "maya.okafor@example.com")
    static let mayaWork = Address(name: "Maya Okafor", address: "maya@northwind.example")
    static let mayaPersonal = Address(name: "Maya Okafor", address: "hello@mayaokafor.example")

    static let daniel = Address(name: "Daniel Reyes", address: "daniel.reyes@northwind.example")
    static let priya = Address(name: "Priya Natarajan", address: "priya@northwind.example")
    static let tomas = Address(name: "Tomas Lindqvist", address: "tomas@lindqvist.example")
    static let chidi = Address(name: "Chidinma Okafor", address: "chidinma.okafor@example.com")
    static let sam = Address(name: "Sam Whitfield", address: "sam@harborbooks.example")
    static let lena = Address(name: "Lena Fischer", address: "lena.fischer@example.org")
    static let jordan = Address(name: "Jordan Ellis", address: "jordan@ellisdesign.example")
    static let noor = Address(name: "Noor Haddad", address: "noor.haddad@example.net")
    static let ravi = Address(name: "Ravi Menon", address: "ravi@menon.example")
    static let hannah = Address(name: "Hannah Brooks", address: "hannah.brooks@example.com")
    static let park = Address(name: "J. Park", address: "j.park@parkproperties.example")
    static let hr = Address(name: "Northwind People Team", address: "people@northwind.example")

    static let codeForge = Address(name: "Code Forge", address: "notifications@codeforge.example")
    static let orbitBank = Address(name: "Orbit Bank", address: "alerts@orbitbank.example")
    static let parcelPost = Address(name: "Parcel Post", address: "shipping@parcelpost.example")
    static let signIn = Address(name: "Pocket", address: "noreply@pocket-id.example")
    static let rail = Address(name: "Trailhead Rail", address: "noreply@trailhead-rail.example")
    static let tracker = Address(name: "Tracker", address: "notifications@tracker.example")
    static let ledger = Address(name: "Ledger", address: "billing@ledgerapp.example")
    static let calendar = Address(name: "Northwind Calendar", address: "calendar-notification@northwind.example")
    static let securityDesk = Address(name: "Northwind Security", address: "no-reply@security.northwind.example")

    static let trellis = Address(name: "The Weekly Trellis", address: "hello@trellis.example")
    static let fieldNotes = Address(name: "Field Notes Daily", address: "news@fieldnotes.example")
    static let makers = Address(name: "Quarterly Maker", address: "editors@quarterlymaker.example")
    static let garden = Address(name: "Garden and Grain", address: "letters@gardenandgrain.example")
    static let markets = Address(name: "Markets in Brief", address: "briefing@marketsbrief.example")
    static let digest = Address(name: "Engineering Digest", address: "digest@engdigest.example")

    /// Headers a mailing list adds. The categorizer files such mail under Newsletters.
    static func listHeaders(id: String, host: String) -> [String: String] {
        [
            "list-id": "<\(id).\(host)>",
            "list-unsubscribe": "<https://\(host)/unsubscribe/abc123>, <mailto:unsubscribe@\(host)>",
            "list-unsubscribe-post": "List-Unsubscribe=One-Click",
            "precedence": "bulk",
        ]
    }

    /// Headers an automated sender adds. The categorizer files such mail under Notifications.
    static let automated = ["auto-submitted": "auto-generated"]
}
