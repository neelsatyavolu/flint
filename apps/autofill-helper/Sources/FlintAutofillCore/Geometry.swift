import Foundation

public struct Display: Equatable {
    /// Frame in AppKit coordinates (origin bottom-left of the primary display, y up).
    public var frame: ScreenRect
    public init(frame: ScreenRect) { self.frame = frame }
}

public enum Geometry {
    /// Converts an AX/CG rectangle (origin top-left of the primary display, y down) to AppKit coordinates (origin bottom-left of the primary display, y up).
    /// `primaryHeight` is the height of the primary display (NSScreen.screens[0].frame.height). The flip is global, so displays above, below and left of the primary work.
    public static func axToAppKit(_ rect: ScreenRect, primaryHeight: Double) -> ScreenRect {
        ScreenRect(x: rect.x, y: primaryHeight - rect.y - rect.height, width: rect.width, height: rect.height)
    }

    static let gap = 4.0

    /// True when the field's rectangle overlaps its window's (both in the same coordinate space). A scrolled-out or clipped field
    /// reports a frame outside the window, and a suggestion placed from it would float over unrelated content.
    public static func isVisible(field: ScreenRect, in window: ScreenRect) -> Bool { overlap(field, window) > 0 }

    static func overlap(_ a: ScreenRect, _ b: ScreenRect) -> Double {
        let w = min(a.x + a.width, b.x + b.width) - max(a.x, b.x)
        let h = min(a.y + a.height, b.y + b.height) - max(a.y, b.y)
        return w > 0 && h > 0 ? w * h : 0
    }

    static func distance(_ a: ScreenRect, _ b: ScreenRect) -> Double {
        let dx = max(b.x - (a.x + a.width), a.x - (b.x + b.width), 0)
        let dy = max(b.y - (a.y + a.height), a.y - (b.y + b.height), 0)
        return dx * dx + dy * dy
    }

    /// Where the suggestion panel goes (AppKit coordinates, origin of its bottom-left corner): just below the field,
    /// clamped inside the display that holds most of the field, flipped above when it would fall off the bottom.
    public static func panelOrigin(field: ScreenRect, panelSize: (width: Double, height: Double), displays: [Display]) -> (x: Double, y: Double) {
        var x = field.x
        var y = field.y - panelSize.height - gap
        guard !displays.isEmpty else { return (x, y) }
        let best = displays.max { overlap($0.frame, field) != overlap($1.frame, field) ? overlap($0.frame, field) < overlap($1.frame, field) : distance($0.frame, field) > distance($1.frame, field) }!.frame
        if y < best.y { y = field.y + field.height + gap }
        x = min(max(x, best.x), max(best.x, best.x + best.width - panelSize.width))
        y = min(max(y, best.y), max(best.y, best.y + best.height - panelSize.height))
        return (x, y)
    }
}
