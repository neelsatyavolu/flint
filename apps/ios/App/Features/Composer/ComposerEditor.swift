import FlintModel
import SwiftUI

/// The body: a rich text editor over `AttributedString`.
struct ComposerEditor: View {
    @Bindable var viewModel: ComposerViewModel
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if viewModel.isBodyLocked { lockedNote }
            editor
        }
    }

    /// A draft written elsewhere keeps its formatting and images: the body is read only until the person flattens it.
    private var lockedNote: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            Text("This draft has formatting or images that can't be edited here. Its body is kept as written. You can still change the recipients, subject and attachments, and send it.", tableName: "Composer")
                .flintText(.label, color: FlintColor.fg2)
                .accessibilityIdentifier("composer.body.lockedNote")
            Button { viewModel.editBodyAsPlainText() } label: {
                Text("Edit as plain text", tableName: "Composer")
                    .flintText(.label, color: FlintColor.accent)
                    .frame(minHeight: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("composer.body.unlock")
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s2)
    }

    private var editor: some View {
        TextEditor(text: $viewModel.body, selection: $viewModel.selection)
            .disabled(viewModel.isBodyLocked)
            .font(RichTextStyle.font(for: []))
            .foregroundStyle(FlintColor.fg)
            .tint(FlintColor.accent)
            .scrollContentBackground(.hidden)
            .scrollDisabled(true)
            .padding(.horizontal, FlintMetrics.Space.s3)
            .frame(minHeight: sizeClass == .regular ? 280 : 200)
            .onChange(of: viewModel.body) { _, _ in viewModel.bodyChanged() }
            .accessibilityLabel(String(localized: "Message", table: "Composer"))
            .accessibilityIdentifier("composer.body")
    }
}

/// The signature under the body, read only, with a menu to swap or remove it.
struct ComposerSignatureBlock: View {
    let viewModel: ComposerViewModel

    var body: some View {
        let available = viewModel.availableSignatures
        if viewModel.signature != nil || !available.isEmpty {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s1) {
                Menu {
                    Button { viewModel.chooseSignature(nil) } label: {
                        Label(String(localized: "No signature", table: "Composer"), systemImage: viewModel.signature == nil ? "checkmark" : "")
                    }
                    ForEach(available) { signature in
                        Button { viewModel.chooseSignature(signature) } label: {
                            Label(signature.name, systemImage: signature.id == viewModel.signature?.id ? "checkmark" : "")
                        }
                    }
                } label: {
                    HStack(spacing: FlintMetrics.Space.s1) {
                        Text(viewModel.signature == nil ? "Add signature" : "Signature", tableName: "Composer").flintText(.label)
                        FlintIconView(icon: .chevronDown, size: 12, color: FlintColor.fg3)
                    }
                    .frame(minHeight: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
                }
                .accessibilityIdentifier("composer.signature.menu")
                if let signature = viewModel.signature {
                    Text(RichTextHTML.attributed(fromHTML: signature.html))
                        .flintText(.body, color: FlintColor.fg3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("composer.signature")
                }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.bottom, FlintMetrics.Space.s3)
        }
    }
}

/// The quoted original of a reply or forward, collapsed behind a pill.
struct ComposerQuoted: View {
    let html: String
    @State private var expanded = false

    var body: some View {
        if !html.isEmpty {
            VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
                Button { expanded.toggle() } label: {
                    Text(expanded ? "Hide quoted text" : "Show quoted text", tableName: "Composer")
                        .flintText(.label, color: FlintColor.fg2)
                        .padding(.horizontal, FlintMetrics.Space.s3)
                        .frame(minHeight: 32)
                        .background(FlintColor.active, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                        .frame(minHeight: FlintMetrics.Size.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("composer.quoted.toggle")
                if expanded {
                    Text(quotedText)
                        .flintText(.body, color: FlintColor.fg3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("composer.quoted")
                }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.bottom, FlintMetrics.Space.s6)
        }
    }

    /// Plain text of the original, cut at a screenful so a long thread doesn't stall the screen.
    private var quotedText: AttributedString {
        var text = RichTextHTML.attributed(fromHTML: String(html.prefix(20_000)))
        text.foregroundColor = nil
        return text
    }
}

/// Bold, italic, link and bullets on the left; read receipt and discard on the right. Sits above the keyboard.
struct ComposerFormatBar: View {
    @Bindable var viewModel: ComposerViewModel
    @State private var showLink = false
    @State private var linkText = ""

    var body: some View {
        HStack(spacing: 0) {
            toggleButton("B", label: String(localized: "Bold", table: "Composer"), id: "composer.format.bold", active: isActive(.bold), bold: true) {
                RichTextFormatting.toggle(.bold, text: &viewModel.body, selection: &viewModel.selection)
            }
            toggleButton("I", label: String(localized: "Italic", table: "Composer"), id: "composer.format.italic", active: isActive(.italic), italic: true) {
                RichTextFormatting.toggle(.italic, text: &viewModel.body, selection: &viewModel.selection)
            }
            toggleButton("Link", label: String(localized: "Link", table: "Composer"), id: "composer.format.link", active: currentLink != nil, wide: true) {
                linkText = currentLink?.absoluteString ?? ""
                showLink = true
            }
            toggleButton("List", label: String(localized: "Bulleted list", table: "Composer"), id: "composer.format.list", active: false, wide: true) {
                RichTextFormatting.toggleBullets(text: &viewModel.body, selection: &viewModel.selection)
            }
            Spacer(minLength: 0)
            templatesMenu
            FlintIconButton(
                icon: .eye, label: String(localized: "Read receipt", table: "Composer"),
                color: viewModel.fields.track ? FlintColor.accent : FlintColor.fg2, identifier: "composer.receipt"
            ) { viewModel.toggleTrack() }
            .accessibilityValue(viewModel.fields.track ? String(localized: "On", table: "Composer") : String(localized: "Off", table: "Composer"))
            FlintIconButton(
                icon: .trash, label: String(localized: "Discard draft", table: "Composer"), identifier: "composer.discard"
            ) { viewModel.confirmDiscard = true }
            .keyboardShortcut("d", modifiers: [.command, .shift])
        }
        .padding(.horizontal, FlintMetrics.Space.s2)
        .background(FlintColor.plane1)
        .overlay(alignment: .top) { FlintHairline() }
        .alert(String(localized: "Link address", table: "Composer"), isPresented: $showLink) {
            TextField(String(localized: "https://", table: "Composer"), text: $linkText)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
            Button(String(localized: "Cancel", table: "Composer"), role: .cancel) {}
            if currentLink != nil {
                Button(String(localized: "Remove link", table: "Composer"), role: .destructive) { applyLink(nil) }
            }
            Button(String(localized: "Add", table: "Composer")) { applyLink(Self.url(from: linkText)) }
        }
    }

    private var templatesMenu: some View {
        Menu {
            if viewModel.templates.isEmpty {
                Text("No templates yet", tableName: "Composer")
            } else {
                ForEach(viewModel.templates) { template in
                    Button(template.name.isEmpty ? String(localized: "Untitled", table: "Composer") : template.name) { viewModel.insert(template) }
                        .accessibilityIdentifier("composer.template.\(template.id)")
                }
            }
        } label: {
            FlintIconView(icon: .fileText, size: 18, color: FlintColor.fg2)
                .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(String(localized: "Insert template", table: "Composer"))
        .accessibilityIdentifier("composer.templates")
    }

    private var currentLink: URL? { RichTextFormatting.link(in: viewModel.body, selection: viewModel.selection) }

    private func isActive(_ trait: RichTextFormatting.Trait) -> Bool {
        RichTextFormatting.isActive(trait, in: viewModel.body, selection: viewModel.selection)
    }

    private func applyLink(_ url: URL?) {
        RichTextFormatting.setLink(url, text: &viewModel.body, selection: &viewModel.selection)
    }

    /// A typed address as a URL, with https:// added when it has no scheme. Nil when it isn't one.
    static func url(from text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains(" ") else { return nil }
        let full = trimmed.contains("://") || trimmed.hasPrefix("mailto:") ? trimmed : "https://\(trimmed)"
        return URL(string: full)
    }

    private func toggleButton(
        _ title: String, label: String, id: String, active: Bool, bold: Bool = false, italic: Bool = false, wide: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .flintText(.label, color: active ? FlintColor.accent : FlintColor.fg2)
                .textCase(nil)
                .fontWeight(bold ? .bold : nil)
                .italic(italic)
                .lineLimit(1)
                .padding(.horizontal, wide ? FlintMetrics.Space.s2 : 0)
                .frame(minWidth: wide ? 52 : FlintMetrics.Size.touch, minHeight: FlintMetrics.Size.touch)
                .background(active ? FlintColor.accentSoft : .clear, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle())
        .disabled(viewModel.isBodyLocked)
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier(id)
    }
}
