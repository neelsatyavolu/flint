import Foundation

/// The third-party software shipped inside Flint, with each project's copyright line and license text. Read from
/// `ThirdPartyLicenses.json`, which lists the packages in `Package.resolved` that the app links, the bundled fonts and the icons.
struct LicenseCatalog: Decodable, Sendable {
    struct Item: Decodable, Hashable, Identifiable, Sendable {
        let name: String
        let version: String
        let license: String
        let copyright: String
        let textId: String
        /// The project's NOTICE file, when it has one.
        let notice: String

        var id: String { name }
    }

    let texts: [String: String]
    let items: [Item]

    func text(for item: Item) -> String { texts[item.textId] ?? "" }
    func item(named name: String) -> Item? { items.first { $0.name == name } }

    static func load(bundle: Bundle = .main) -> LicenseCatalog? {
        guard let url = bundle.url(forResource: "ThirdPartyLicenses", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(LicenseCatalog.self, from: data)
    }
}
