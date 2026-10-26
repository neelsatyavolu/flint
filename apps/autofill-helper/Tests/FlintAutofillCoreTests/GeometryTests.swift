import XCTest
@testable import FlintAutofillCore

final class GeometryTests: XCTestCase {
    private func r(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> ScreenRect { ScreenRect(x: x, y: y, width: w, height: h) }

    func testAxToAppKitOnPrimary() {
        XCTAssertEqual(Geometry.axToAppKit(r(100, 200, 300, 40), primaryHeight: 900), r(100, 660, 300, 40))
    }
    func testAxToAppKitOnDisplayAbovePrimary() {
        // A display above the primary has negative AX y; in AppKit it sits above primaryHeight.
        XCTAssertEqual(Geometry.axToAppKit(r(10, -500, 100, 20), primaryHeight: 900), r(10, 1380, 100, 20))
    }
    func testAxToAppKitOnDisplayLeftAndBelow() {
        XCTAssertEqual(Geometry.axToAppKit(r(-1440, 950, 200, 30), primaryHeight: 900), r(-1440, -80, 200, 30))
    }
    func testFieldVisibilityInsideWindow() {
        let window = r(100, 100, 800, 600)
        XCTAssertTrue(Geometry.isVisible(field: r(200, 300, 200, 30), in: window))
        XCTAssertTrue(Geometry.isVisible(field: r(850, 300, 200, 30), in: window)) // partly clipped still shows
        XCTAssertFalse(Geometry.isVisible(field: r(200, 900, 200, 30), in: window)) // scrolled below the window
        XCTAssertFalse(Geometry.isVisible(field: r(200, 40, 200, 30), in: window))
    }
    func testRoundTrip() {
        let a = r(12, 34, 56, 78)
        XCTAssertEqual(Geometry.axToAppKit(Geometry.axToAppKit(a, primaryHeight: 777), primaryHeight: 777), a)
    }

    let primary = Display(frame: ScreenRect(x: 0, y: 0, width: 1440, height: 900))
    let left = Display(frame: ScreenRect(x: -1920, y: 0, width: 1920, height: 1080))

    func testBelowTheField() {
        let o = Geometry.panelOrigin(field: r(200, 500, 300, 36), panelSize: (220, 40), displays: [primary])
        XCTAssertEqual(o.x, 200); XCTAssertEqual(o.y, 500 - 40 - 4)
    }
    func testFlipsAboveNearTheBottom() {
        let o = Geometry.panelOrigin(field: r(200, 20, 300, 36), panelSize: (220, 40), displays: [primary])
        XCTAssertEqual(o.y, 20 + 36 + 4)
    }
    func testClampsRight() {
        let o = Geometry.panelOrigin(field: r(1400, 500, 30, 36), panelSize: (220, 40), displays: [primary])
        XCTAssertEqual(o.x, 1440 - 220)
    }
    func testStaysOnTheFieldsDisplay() {
        let o = Geometry.panelOrigin(field: r(-1900, 600, 300, 36), panelSize: (220, 40), displays: [primary, left])
        XCTAssertEqual(o.x, -1900); XCTAssertEqual(o.y, 556)
        let edge = Geometry.panelOrigin(field: r(-150, 600, 160, 36), panelSize: (220, 40), displays: [primary, left])
        XCTAssertEqual(edge.x, -220) // mostly on the left display: clamped to its right edge
    }
    func testNoDisplays() {
        let o = Geometry.panelOrigin(field: r(5, 100, 10, 10), panelSize: (50, 20), displays: [])
        XCTAssertEqual(o.x, 5); XCTAssertEqual(o.y, 76)
    }
}
