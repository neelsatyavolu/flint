import AppKit
import FlintAutofillCore

/// Panel that never becomes key or main, so the field keeps focus.
private final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Flint-styled rows: graphite plane, 1px line, 6px radius, one row per waiting code.
private final class RowsView: NSView {
    var codes: [HelperCode] = []
    var hovered = -1
    var onPick: ((HelperCode) -> Void)?

    static let rowHeight: CGFloat = 30
    static let padding: CGFloat = 4
    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    var isDark: Bool { effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }
    // Tokens from DESIGN.md: plane-3, line-strong, fg, fg-3, accent (Graphite and Paper).
    var plane: NSColor { isDark ? NSColor(srgbRed: 0x23 / 255, green: 0x23 / 255, blue: 0x21 / 255, alpha: 1) : .white }
    var line: NSColor { isDark ? NSColor(srgbRed: 0xED / 255, green: 0xEB / 255, blue: 0xE5 / 255, alpha: 0.18) : NSColor(srgbRed: 0x1A / 255, green: 0x1A / 255, blue: 0x17 / 255, alpha: 0.20) }
    var fg: NSColor { isDark ? NSColor(srgbRed: 0xED / 255, green: 0xEB / 255, blue: 0xE5 / 255, alpha: 1) : NSColor(srgbRed: 0x1A / 255, green: 0x1A / 255, blue: 0x17 / 255, alpha: 1) }
    var fg3: NSColor { fg.withAlphaComponent(0.55) }
    var accent: NSColor { isDark ? NSColor(srgbRed: 0x4C / 255, green: 0x8D / 255, blue: 0xFF / 255, alpha: 1) : NSColor(srgbRed: 0x2F / 255, green: 0x6F / 255, blue: 0xE0 / 255, alpha: 1) }

    func font(_ names: [String], _ size: CGFloat, _ weight: NSFont.Weight, mono: Bool = false) -> NSFont {
        for name in names { if let f = NSFont(name: name, size: size) { return f } }
        return mono ? .monospacedSystemFont(ofSize: size, weight: weight) : .systemFont(ofSize: size, weight: weight)
    }
    var sans: NSFont { font(["Geist"], 12, .regular) }
    var mono: NSFont { font(["Geist Mono"], 12.5, .semibold, mono: true) }
    var small: NSFont { font(["Geist Mono"], 10.5, .regular, mono: true) }

    func parts(_ c: HelperCode) -> [(String, NSFont, NSColor)] {
        [("Fill ", sans, fg3), (c.code, mono, fg), ("  \u{00B7}  ", sans, fg3), (c.service.uppercased(), small, fg3)]
    }
    func width(of c: HelperCode) -> CGFloat {
        parts(c).reduce(0) { $0 + NSAttributedString(string: $1.0, attributes: [.font: $1.1]).size().width }
    }
    var contentSize: NSSize {
        let w = (codes.map(width).max() ?? 80) + 10 + 8 + 12 * 2 + Self.padding * 2
        return NSSize(width: min(max(w.rounded(.up), 150), 340), height: CGFloat(codes.count) * Self.rowHeight + Self.padding * 2)
    }

    override func draw(_ dirtyRect: NSRect) {
        let outline = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6)
        plane.setFill(); outline.fill()
        line.setStroke(); outline.lineWidth = 1; outline.stroke()
        for (i, c) in codes.enumerated() {
            let row = NSRect(x: Self.padding, y: Self.padding + CGFloat(i) * Self.rowHeight, width: bounds.width - Self.padding * 2, height: Self.rowHeight)
            if i == hovered {
                accent.withAlphaComponent(0.14).setFill()
                NSBezierPath(roundedRect: row, xRadius: 4, yRadius: 4).fill()
            }
            drawMark(center: NSPoint(x: row.minX + 12, y: row.midY))
            var x = row.minX + 12 + 5 + 8
            for (text, f, color) in parts(c) {
                let s = NSAttributedString(string: text, attributes: [.font: f, .foregroundColor: color])
                let size = s.size()
                s.draw(at: NSPoint(x: x, y: row.midY - size.height / 2)); x += size.width
            }
        }
    }

    /// The Flint spark: a four-point star in the accent color.
    func drawMark(center c: NSPoint) {
        let r: CGFloat = 5, k: CGFloat = 1.4
        let p = NSBezierPath()
        p.move(to: NSPoint(x: c.x, y: c.y - r))
        p.line(to: NSPoint(x: c.x + k, y: c.y - k)); p.line(to: NSPoint(x: c.x + r, y: c.y)); p.line(to: NSPoint(x: c.x + k, y: c.y + k))
        p.line(to: NSPoint(x: c.x, y: c.y + r)); p.line(to: NSPoint(x: c.x - k, y: c.y + k)); p.line(to: NSPoint(x: c.x - r, y: c.y)); p.line(to: NSPoint(x: c.x - k, y: c.y - k))
        p.close(); accent.setFill(); p.fill()
    }

    func row(at point: NSPoint) -> Int {
        let i = Int((point.y - Self.padding) / Self.rowHeight)
        return (point.y >= Self.padding && i >= 0 && i < codes.count) ? i : -1
    }
    override func updateTrackingAreas() {
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways], owner: self))
    }
    override func mouseMoved(with event: NSEvent) { hovered = row(at: convert(event.locationInWindow, from: nil)); needsDisplay = true }
    override func mouseExited(with event: NSEvent) { hovered = -1; needsDisplay = true }
    override func mouseDown(with event: NSEvent) {
        let i = row(at: convert(event.locationInWindow, from: nil))
        if i >= 0 { onPick?(codes[i]) }
    }
}

/// The suggestion shown next to a code field. Non-activating: clicking a row never moves focus out of the field.
final class SuggestionPanel {
    private let panel: NSPanel
    private let rows = RowsView()
    var onPick: ((HelperCode) -> Void)? { didSet { rows.onPick = onPick } }
    private(set) var codes: [HelperCode] = []
    var isShown: Bool { panel.isVisible }

    init() {
        panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 200, height: 38), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .popUpMenu
        panel.hidesOnDeactivate = false
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        panel.contentView = rows
    }

    /// `field` is in AX coordinates (top-left origin, y down).
    func show(codes: [HelperCode], field: ScreenRect) {
        self.codes = Array(codes.prefix(4))
        rows.codes = self.codes
        rows.hovered = -1
        let size = rows.contentSize
        panel.setContentSize(size)
        place(field: field, size: size)
        rows.needsDisplay = true
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    func move(field: ScreenRect) { if panel.isVisible { place(field: field, size: panel.frame.size) } }

    func hide() { if panel.isVisible { panel.orderOut(nil) }; codes = [] }

    private func place(field: ScreenRect, size: NSSize) {
        let primaryHeight = Double(NSScreen.screens.first?.frame.height ?? 0)
        let appKitField = Geometry.axToAppKit(field, primaryHeight: primaryHeight)
        let displays = NSScreen.screens.map { s in
            Display(frame: ScreenRect(x: Double(s.frame.minX), y: Double(s.frame.minY), width: Double(s.frame.width), height: Double(s.frame.height)))
        }
        let origin = Geometry.panelOrigin(field: appKitField, panelSize: (Double(size.width), Double(size.height)), displays: displays)
        panel.setFrameOrigin(NSPoint(x: origin.x, y: origin.y))
    }
}
