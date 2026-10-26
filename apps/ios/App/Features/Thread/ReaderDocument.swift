import Foundation
import UIKit

/// Colors the reader page needs, resolved from the asset catalog for one theme so the page matches Graphite or Paper.
struct ReaderPalette: Equatable, Sendable {
    let fg: String
    let fg3: String
    let accent: String
    let line: String

    @MainActor
    static func make(dark: Bool) -> ReaderPalette {
        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        func hex(_ name: String) -> String {
            let color = (UIColor(named: name) ?? .gray).resolvedColor(with: traits)
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
            color.getRed(&r, green: &g, blue: &b, alpha: &a)
            return String(format: "#%02x%02x%02x", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
        }
        return ReaderPalette(fg: hex("Fg"), fg3: hex("Fg3"), accent: hex("Accent"), line: hex("Line"))
    }
}

/// The page the reader loads: mail HTML inside a small shell that carries the theme colors, the adapt mode and a pending
/// flag. Pure string work, so it is unit tested.
struct ReaderDocument: Equatable, Sendable {
    let html: String
    let appearance: MailAppearance
    let palette: ReaderPalette
    /// Attachment ids to content types, for the `flint-attachment://` scheme handler.
    let attachmentTypes: [Int: String]
    let allowImages: Bool

    /// Same key, same page: the web view reloads only when this changes.
    var key: String {
        "\(html.hashValue)|\(appearance.adapt.rawValue)|\(appearance.lightSheet)|\(palette.fg)|\(allowImages)"
    }

    var page: String {
        let sheet = appearance.lightSheet ? "light" : "theme"
        return """
        <!doctype html><html data-adapt="\(appearance.adapt.rawValue)" data-sheet="\(sheet)" data-pending>\
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\
        <meta name="color-scheme" content="light dark"><style>\(css)</style></head><body>\(html)</body></html>
        """
    }

    private var css: String {
        """
        :root{--fg:\(palette.fg);--fg3:\(palette.fg3);--accent:\(palette.accent);--line:\(palette.line)}
        html{-webkit-text-size-adjust:100%;background:transparent}
        body{margin:0;font:14.5px/1.5 Geist,-apple-system,sans-serif;color:var(--fg);background:transparent;overflow-wrap:anywhere;word-break:normal}
        html[data-sheet=light] body{background:#fff;color:#1b1a17;padding:12px;border-radius:4px}
        html[data-sheet=light]{--accent:#1f5fd6}
        img{max-width:100%;height:auto}
        table{max-width:100%}
        a{color:var(--accent)}
        pre{white-space:pre-wrap}
        html[data-pending] body{opacity:0;animation:flint-reveal 0s 1.5s forwards}
        @keyframes flint-reveal{to{opacity:1}}
        """
    }
}
