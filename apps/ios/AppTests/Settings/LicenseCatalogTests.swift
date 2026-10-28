@testable import Flint
import Foundation
import Testing

@Suite("License catalog")
struct LicenseCatalogTests {
    private func catalog() throws -> LicenseCatalog { try #require(LicenseCatalog.load()) }

    @Test("BoringSSL ships inside swift-nio-ssl, so its licence texts are in the catalog")
    func boringSSL() throws {
        let catalog = try catalog()
        let item = try #require(catalog.items.first { $0.name.hasPrefix("BoringSSL") })
        let text = catalog.text(for: item)
        for required in ["OpenSSL License", "Original SSLeay License", "Eric Young", "ISC license", "fiat-crypto"] {
            #expect(text.contains(required), "\(required)")
        }
    }

    @Test("every item points at a text that exists")
    func textsResolve() throws {
        let catalog = try catalog()
        for item in catalog.items { #expect(!catalog.text(for: item).isEmpty, "\(item.name)") }
    }
}
