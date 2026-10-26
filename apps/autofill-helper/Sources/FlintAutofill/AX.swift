import ApplicationServices
import FlintAutofillCore
import Foundation

/// Thin readers over the C Accessibility API. Every read can fail (apps come and go), so everything returns optionals.
enum AX {
    static func attr(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
    }
    static func string(_ element: AXUIElement, _ name: String) -> String? { attr(element, name) as? String }
    static func strings(_ element: AXUIElement, _ name: String) -> [String] { (attr(element, name) as? [Any])?.compactMap { $0 as? String } ?? [] }
    static func element(_ element: AXUIElement, _ name: String) -> AXUIElement? {
        guard let v = attr(element, name), CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }
    static func elements(_ element: AXUIElement, _ name: String, limit: Int = 64) -> [AXUIElement] {
        guard let list = attr(element, name) as? [AXUIElement] else { return [] }
        return Array(list.prefix(limit))
    }
    static func url(_ element: AXUIElement, _ name: String) -> String? {
        guard let v = attr(element, name) else { return nil }
        if let s = v as? String { return s }
        if CFGetTypeID(v) == CFURLGetTypeID() { return (v as! URL).absoluteString }
        return nil
    }
    /// Frame in AX coordinates (top-left origin of the primary display, y down).
    static func frame(_ element: AXUIElement) -> ScreenRect? {
        guard let p = attr(element, kAXPositionAttribute as String), let s = attr(element, kAXSizeAttribute as String),
              CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(p as! AXValue, .cgPoint, &point), AXValueGetValue(s as! AXValue, .cgSize, &size) else { return nil }
        return ScreenRect(x: Double(point.x), y: Double(point.y), width: Double(size.width), height: Double(size.height))
    }
    static func isSettable(_ element: AXUIElement, _ name: String) -> Bool {
        var settable: DarwinBoolean = false
        return AXUIElementIsAttributeSettable(element, name as CFString, &settable) == .success && settable.boolValue
    }
}

/// What the helper knows about the focused element.
struct FocusedField {
    var element: AXUIElement
    var pid: pid_t
    var frame: ScreenRect
    var verdict: FieldVerdict
    var pageHost: String?
    /// The field's window, when AX reports it; used to hide the suggestion for a field that is scrolled out of view.
    var windowFrame: ScreenRect?
    /// Secure, search and password/card style fields: never typed into, not even by the shortcut.
    var forbidden: Bool
    /// Elements of the split boxes in order, when the field is one box of a split input (used by the AXValue fallback).
    var boxes: [AXUIElement]
    var focusedBoxIndex: Int
}

enum FieldReader {
    /// One read of the focused field may spend at most this long on AX calls (each call is also capped by the 0.25 s messaging timeout).
    static let budget: TimeInterval = 0.6
    static let maxSiblings = 32

    static func read(_ element: AXUIElement, pid: pid_t) -> FocusedField? {
        guard let frame = AX.frame(element) else { return nil }
        let deadline = Date().addingTimeInterval(budget)
        var attrs = FieldAttributes(
            role: AX.string(element, kAXRoleAttribute as String),
            subrole: AX.string(element, kAXSubroleAttribute as String),
            placeholder: AX.string(element, "AXPlaceholderValue"),
            title: AX.string(element, kAXTitleAttribute as String),
            description: AX.string(element, kAXDescriptionAttribute as String),
            help: AX.string(element, kAXHelpAttribute as String),
            labelText: labelText(element),
            domIdentifier: AX.string(element, "AXDOMIdentifier"),
            domClasses: AX.strings(element, "AXDOMClassList"),
            identifier: AX.string(element, "AXIdentifier"),
            maxLength: nil)
        var verdict = FieldClassifier.classify(attrs)
        var boxes: [AXUIElement] = []
        var boxIndex = 0

        // Only look at siblings for narrow text fields, so ordinary fields never cost extra AX calls.
        if frame.width <= 72, let role = attrs.role, FieldClassifier.textRoles.contains(role), let parent = AX.element(element, kAXParentAttribute as String) {
            let children = Array(AX.elements(parent, kAXChildrenAttribute as String, limit: maxSiblings))
            let siblings = children.map { child -> SiblingField in
                guard Date() < deadline else { return SiblingField(isTextField: false, maxLength: nil, frame: ScreenRect(x: 0, y: 0, width: 0, height: 0)) }
                let r = AX.string(child, kAXRoleAttribute as String)
                return SiblingField(isTextField: r.map(FieldClassifier.textRoles.contains) ?? false, isSecure: r == "AXSecureTextField",
                                    maxLength: nil, frame: AX.frame(child) ?? ScreenRect(x: 0, y: 0, width: 0, height: 0))
            }
            if let idx = children.firstIndex(where: { CFEqual($0, element) }), SplitFields.looksLikeSplitBoxes(siblings: siblings, focused: idx) {
                attrs.maxLength = 1
                verdict = FieldClassifier.classify(attrs)
                if case .splitCodeField = verdict {
                    var start = idx, end = idx
                    let sized = siblings.map { $0.isTextField && !$0.isSecure && $0.frame.width <= 72 }
                    while start > 0, sized[start - 1] { start -= 1 }
                    while end + 1 < sized.count, sized[end + 1] { end += 1 }
                    boxes = Array(children[start...end])
                    boxIndex = idx - start
                    verdict = .splitCodeField(siblings: boxes.count)
                }
            }
        }
        let window = AX.element(element, kAXWindowAttribute as String)
        return FocusedField(element: element, pid: pid, frame: frame, verdict: verdict, pageHost: pageHost(of: element, window: window, deadline: deadline),
                            windowFrame: window.flatMap(AX.frame), forbidden: FieldClassifier.isForbidden(attrs), boxes: boxes, focusedBoxIndex: boxIndex)
    }

    static func labelText(_ element: AXUIElement) -> String? {
        guard let label = AX.element(element, kAXTitleUIElementAttribute as String) else { return nil }
        return AX.string(label, kAXValueAttribute as String) ?? AX.string(label, kAXTitleAttribute as String)
    }

    /// Browsers expose the tab's address on the AXWebArea ancestor (AXURL); some apps put it on the window as AXDocument.
    static func pageHost(of element: AXUIElement, window: AXUIElement?, deadline: Date) -> String? {
        var current: AXUIElement? = element
        for _ in 0..<14 {
            guard let el = current, Date() < deadline else { break }
            if let url = AX.url(el, kAXURLAttribute as String), let host = CodeRanking.host(ofURL: url) { return host }
            current = AX.element(el, kAXParentAttribute as String)
        }
        if let window, let doc = AX.url(window, kAXDocumentAttribute as String) { return CodeRanking.host(ofURL: doc) }
        return nil
    }
}
