import Foundation
import SwiftUI

/// The editor's fonts. Bold and italic are kept twice: as `inlinePresentationIntent` (what the HTML is built from) and as a
/// font (what the editor draws).
enum RichTextStyle {
    static let size: CGFloat = 14.5

    static func font(for intent: InlinePresentationIntent) -> Font {
        let face = intent.contains(.stronglyEmphasized) ? "Geist-SemiBold" : "Geist-Regular"
        let font = Font.custom(face, size: size, relativeTo: .body)
        return intent.contains(.emphasized) ? font.italic() : font
    }
}

/// Bold, italic, link and bullet edits on the editor text and its selection.
enum RichTextFormatting {
    enum Trait {
        case bold, italic

        var intent: InlinePresentationIntent { self == .bold ? .stronglyEmphasized : .emphasized }
    }

    /// True when the whole selection has the trait, or the insertion point would type with it.
    static func isActive(_ trait: Trait, in text: AttributedString, selection: AttributedTextSelection) -> Bool {
        switch selection.indices(in: text) {
        case .insertionPoint:
            return selection.typingAttributes(in: text).inlinePresentationIntent?.contains(trait.intent) ?? false
        case .ranges:
            var any = false
            for value in selection.attributes(in: text)[\.inlinePresentationIntent] {
                any = true
                if value?.contains(trait.intent) != true { return false }
            }
            return any
        }
    }

    static func toggle(_ trait: Trait, text: inout AttributedString, selection: inout AttributedTextSelection) {
        let turnOn = !isActive(trait, in: text, selection: selection)
        text.transformAttributes(in: &selection) { container in
            var intent = container.inlinePresentationIntent ?? []
            if turnOn { intent.insert(trait.intent) } else { intent.remove(trait.intent) }
            container.inlinePresentationIntent = intent.isEmpty ? nil : intent
            container.font = RichTextStyle.font(for: intent)
        }
    }

    /// True when the selection is on a link.
    static func link(in text: AttributedString, selection: AttributedTextSelection) -> URL? {
        for value in selection.attributes(in: text)[\.link] { if let value { return value } }
        return selection.typingAttributes(in: text).link
    }

    /// Links the selected text. With nothing selected, inserts the address as a link. A nil `url` removes the link.
    static func setLink(_ url: URL?, text: inout AttributedString, selection: inout AttributedTextSelection) {
        if case .insertionPoint = selection.indices(in: text), let url {
            var inserted = AttributedString(url.absoluteString)
            inserted.link = url
            inserted.font = RichTextStyle.font(for: [])
            text.replaceSelection(&selection, with: inserted)
            return
        }
        text.transformAttributes(in: &selection) { $0.link = url }
    }

    // MARK: Bullets

    private static func bounds(_ selection: AttributedTextSelection, in text: AttributedString) -> (AttributedString.Index, AttributedString.Index) {
        switch selection.indices(in: text) {
        case .insertionPoint(let point): return (point, point)
        case .ranges(let set):
            guard let first = set.ranges.first, let last = set.ranges.last else { return (text.startIndex, text.startIndex) }
            return (first.lowerBound, last.upperBound)
        }
    }

    /// Character offsets of the start of every line the selection touches.
    static func lineStarts(in text: AttributedString, selection: AttributedTextSelection) -> [Int] {
        let (lo, hi) = bounds(selection, in: text)
        let characters = Array(text.characters)
        let low = text.characters.distance(from: text.characters.startIndex, to: lo)
        let high = text.characters.distance(from: text.characters.startIndex, to: hi)
        var first = low
        while first > 0, !characters[first - 1].isNewline { first -= 1 }
        var starts = [first]
        for index in low..<max(low, high) where characters[index].isNewline { starts.append(index + 1) }
        return starts
    }

    /// Turns the lines the selection touches into bullets, or back into plain lines when they all are bullets already.
    static func toggleBullets(text: inout AttributedString, selection: inout AttributedTextSelection) {
        let starts = lineStarts(in: text, selection: selection)
        let characters = text.characters
        let allBullets = starts.allSatisfy { start in
            let begin = characters.index(characters.startIndex, offsetBy: start)
            return String(characters[begin...].prefix(RichTextHTML.bullet.count)) == RichTextHTML.bullet
        }
        text.transform(updating: &selection) { edited in
            for start in starts.reversed() {
                let index = edited.characters.index(edited.characters.startIndex, offsetBy: start)
                if allBullets {
                    let end = edited.characters.index(index, offsetBy: RichTextHTML.bullet.count)
                    edited.characters.removeSubrange(index..<end)
                } else {
                    edited.characters.insert(contentsOf: RichTextHTML.bullet, at: index)
                }
            }
        }
    }
}
