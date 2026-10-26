import XCTest
@testable import FlintAutofillCore

final class ProtocolTests: XCTestCase {
    private func fixtures() throws -> [String: [Any]] {
        let url = Bundle.module.url(forResource: "protocol", withExtension: "json", subdirectory: "Fixtures")!
        return try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: [Any]]
    }
    private func line(_ object: Any) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]), as: UTF8.self)
    }

    func testEveryGoldenCommandDecodesAndRoundTrips() throws {
        let commands = try fixtures()["commands"]!
        XCTAssertEqual(commands.count, 8)
        for raw in commands {
            let command = try Wire.decodeCommand(try line(raw))
            let again = try JSONEncoder().encode(command)
            XCTAssertEqual(try Wire.decodeCommand(String(decoding: again, as: UTF8.self)), command)
        }
    }

    func testEveryGoldenEventDecodesAndEncodesToTheSameJSON() throws {
        for raw in try fixtures()["events"]! {
            let event = try JSONDecoder().decode(Event.self, from: Data(try line(raw).utf8))
            let encoded = Wire.encodeLine(event)
            XCTAssertTrue(encoded.hasSuffix("\n"))
            let a = try JSONSerialization.jsonObject(with: Data(encoded.utf8)) as! NSDictionary
            XCTAssertEqual(a, raw as! NSDictionary)
        }
    }

    func testRejectsJunkAndUnknownOps() {
        XCTAssertThrowsError(try Wire.decodeCommand("nope")) { XCTAssertEqual($0 as? ProtocolError, .notJSON) }
        XCTAssertThrowsError(try Wire.decodeCommand("{\"op\":\"explode\"}")) { XCTAssertEqual($0 as? ProtocolError, .unknownOp("explode")) }
        XCTAssertThrowsError(try Wire.decodeCommand("{\"op\":\"codes\"}"))
    }
}
