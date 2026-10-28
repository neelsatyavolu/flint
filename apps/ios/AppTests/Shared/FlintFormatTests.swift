@testable import Flint
import FlintModel
import Testing

/// Cases follow `lib/format.ts` of the desktop app.
@Suite("Formatting helpers")
struct FlintFormatTests {
    private let carla = Address(name: "Carla Gomez", address: "carla@example.com")
    private let rodney = Address(name: "Rodney Ames", address: "rodney@example.com")
    private let bare = Address(name: " ", address: "jo.smith@example.com")

    @Test("display and first names")
    func names() {
        #expect(FlintFormat.displayName(carla) == "Carla Gomez")
        #expect(FlintFormat.displayName(bare) == "jo.smith")
        #expect(FlintFormat.firstName(carla) == "Carla")
    }

    @Test("participants: one full name, several first names, plus N, duplicates folded")
    func participants() {
        #expect(FlintFormat.participants([carla]) == "Carla Gomez")
        #expect(FlintFormat.participants([carla, rodney]) == "Carla, Rodney")
        #expect(FlintFormat.participants([carla, rodney, bare, Address(name: "Dee Fox", address: "dee@example.com")]) == "Carla, Rodney, jo.smith +1")
        #expect(FlintFormat.participants([carla, Address(name: "Carla", address: "CARLA@example.com")]) == "Carla Gomez")
        #expect(FlintFormat.participants([]) == "")
    }

    @Test("addresses and recipient lines")
    func addresses() {
        #expect(FlintFormat.address(carla) == "Carla Gomez <carla@example.com>")
        #expect(FlintFormat.address(bare) == "jo.smith@example.com")
        #expect(FlintFormat.recipients([carla, rodney], selfAddresses: ["RODNEY@example.com"]) == "to Carla, me")
        #expect(FlintFormat.recipients([]) == "")
    }

    @Test("file sizes and plurals")
    func sizes() {
        #expect(FlintFormat.fileSize(-1) == "0 B")
        #expect(FlintFormat.fileSize(512) == "512 B")
        #expect(FlintFormat.fileSize(1536) == "1.5 KB")
        #expect(FlintFormat.fileSize(2048) == "2 KB")
        #expect(FlintFormat.fileSize(12 * 1024 * 1024) == "12 MB")
        #expect(FlintFormat.plural(1, "thread") == "1 thread")
        #expect(FlintFormat.plural(3, "thread") == "3 threads")
        #expect(FlintFormat.plural(2, "person", "people") == "2 people")
    }
}
