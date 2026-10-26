import FlintModel
import Foundation

/// Signatures and templates are stored as HTML. The iPhone editors are plain text, so this converts both ways. The editors
/// only rewrite the stored HTML when the text changed, so formatting made on the Mac survives opening and saving.
enum SignatureText {
    /// The visible text of stored HTML: block ends and `<br>` become line breaks, tags are dropped, entities decoded.
    static func plain(fromHTML html: String) -> String {
        var text = html
        text = replace(#"(?is)<(style|script|head)\b.*?</\1>"#, in: text, with: "")
        text = replace(#"(?i)<br\s*/?>"#, in: text, with: "\n")
        text = replace(#"(?i)</(p|div|li|h[1-6]|tr)>"#, in: text, with: "\n")
        text = replace(#"(?s)<[^>]*>"#, in: text, with: "")
        text = decodeEntities(text)
        return text.replacingOccurrences(of: "\u{00A0}", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Plain text as HTML: one `<div>` per line, a blank line as `<br>`, characters escaped.
    static func html(fromPlain text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        return trimmed.components(separatedBy: .newlines).map { line in
            line.trimmingCharacters(in: .whitespaces).isEmpty ? "<div><br></div>" : "<div>\(escape(line))</div>"
        }.joined()
    }

    static func escape(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// What to store: the original HTML when the text is what it showed, else the converted text.
    static func htmlToStore(original: String, shown: String, edited: String) -> String {
        edited == shown ? original : html(fromPlain: edited)
    }

    private static func replace(_ pattern: String, in text: String, with template: String) -> String {
        text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }

    private static func decodeEntities(_ text: String) -> String {
        let named = ["&nbsp;": " ", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'"]
        var out = text
        for (entity, value) in named { out = out.replacingOccurrences(of: entity, with: value) }
        return out.replacingOccurrences(of: "&amp;", with: "&")
    }
}

/// A signature being edited.
struct SignatureDraft: Equatable {
    var id: Int?
    var name = ""
    var accountIds: [AccountID] = []
    var defaultNew = false
    var defaultReply = false
    /// The HTML as stored, and the text the editor first showed for it.
    var originalHTML = ""
    var shownText = ""
    var text = ""

    init() {}

    init(_ signature: Signature) {
        id = signature.id
        name = signature.name
        accountIds = signature.accountIds
        defaultNew = signature.defaultNew
        defaultReply = signature.defaultReply
        originalHTML = signature.html
        shownText = SignatureText.plain(fromHTML: signature.html)
        text = shownText
    }

    var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func signature() -> Signature {
        Signature(id: id ?? 0, name: name.trimmingCharacters(in: .whitespaces),
                  html: SignatureText.htmlToStore(original: originalHTML, shown: shownText, edited: text),
                  accountIds: accountIds, defaultNew: defaultNew, defaultReply: defaultReply)
    }
}

/// A template being edited.
struct TemplateDraft: Equatable {
    var id: Int?
    var name = ""
    var subject = ""
    var originalHTML = ""
    var shownText = ""
    var text = ""

    init() {}

    init(_ template: Template) {
        id = template.id
        name = template.name
        subject = template.subject
        originalHTML = template.html
        shownText = SignatureText.plain(fromHTML: template.html)
        text = shownText
    }

    var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func template() -> Template {
        Template(id: id ?? 0, name: name.trimmingCharacters(in: .whitespaces), subject: subject.trimmingCharacters(in: .whitespaces),
                 html: SignatureText.htmlToStore(original: originalHTML, shown: shownText, edited: text))
    }
}
