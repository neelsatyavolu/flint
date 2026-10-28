import FlintModel
import SwiftUI

/// Recipients, subject, notes, attachments and the editor, in one scroll, with the format bar above the keyboard.
struct ComposerForm: View {
    @Bindable var viewModel: ComposerViewModel
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var showCc = false
    @State private var showBcc = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                fromRow
                recipients
                subject
                notes
                ComposerAttachments(attachments: viewModel.fields.attachments) { attachment in
                    Task { await viewModel.removeAttachment(attachment) }
                }
                ComposerEditor(viewModel: viewModel)
                ComposerSignatureBlock(viewModel: viewModel)
                ComposerQuoted(html: viewModel.quotedHTML)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .safeAreaInset(edge: .bottom, spacing: 0) { ComposerFormatBar(viewModel: viewModel) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.form")
    }

    // MARK: Fields

    @ViewBuilder private var fromRow: some View {
        let options = viewModel.fromOptions
        if options.count > 1 {
            // At accessibility sizes the label goes above the address and the address wraps instead of being cut.
            let stacked = typeSize.isAccessibilitySize
            let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 0)) : AnyLayout(HStackLayout(spacing: FlintMetrics.Space.s2))
            layout {
                Text("From", tableName: "Composer").flintText(.label).lineLimit(1).fixedSize().frame(minWidth: 36, alignment: .leading)
                    .padding(.top, stacked ? FlintMetrics.Space.s2 : 0)
                Menu {
                    ForEach(options) { option in
                        Button { viewModel.chooseFrom(option) } label: {
                            if option.address == viewModel.fields.from {
                                Label(option.address, systemImage: "checkmark")
                            } else {
                                Text(option.address)
                            }
                        }
                    }
                } label: {
                    HStack(spacing: FlintMetrics.Space.s1) {
                        Text(viewModel.fields.from).flintText(.body).lineLimit(stacked ? nil : 1)
                            .fixedSize(horizontal: false, vertical: stacked)
                        FlintIconView(icon: .chevronDown, size: 14, color: FlintColor.fg3)
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
                }
                .accessibilityLabel(String(localized: "From", table: "Composer"))
                .accessibilityValue(viewModel.fields.from)
                .accessibilityIdentifier("composer.from")
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            FlintHairline()
        }
    }

    @ViewBuilder private var recipients: some View {
        RecipientField(
            label: String(localized: "To", table: "Composer"), identifier: "composer.to", addresses: binding(\.to),
            invalid: viewModel.problem == FlintNoRecipients.text,
            autoFocus: viewModel.mode == .new && viewModel.fields.to.isEmpty, suggest: suggest,
            trailing: {
                HStack(spacing: 0) {
                    if !(showCc || !viewModel.fields.cc.isEmpty) { reveal("Cc", id: "composer.revealCc") { showCc = true } }
                    if !(showBcc || !viewModel.fields.bcc.isEmpty) { reveal("Bcc", id: "composer.revealBcc") { showBcc = true } }
                }
            })
        if showCc || !viewModel.fields.cc.isEmpty {
            RecipientField(label: "Cc", identifier: "composer.cc", addresses: binding(\.cc), autoFocus: showCc && viewModel.fields.cc.isEmpty, suggest: suggest) {}
        }
        if showBcc || !viewModel.fields.bcc.isEmpty {
            RecipientField(label: "Bcc", identifier: "composer.bcc", addresses: binding(\.bcc), autoFocus: showBcc && viewModel.fields.bcc.isEmpty, suggest: suggest) {}
        }
    }

    private var subject: some View {
        VStack(spacing: 0) {
            TextField(
                "", text: Binding(get: { viewModel.fields.subject }, set: { value in viewModel.edit { $0.subject = value } }),
                prompt: Text("Subject", tableName: "Composer").foregroundStyle(FlintColor.fg4), axis: .vertical
            )
            .flintText(sizeClass == .regular ? .subject : .title)
            .submitLabel(.next)
            .padding(.horizontal, FlintMetrics.Space.s4)
            .frame(minHeight: FlintMetrics.Size.touch)
            .accessibilityLabel(String(localized: "Subject", table: "Composer"))
            .accessibilityIdentifier("composer.subject")
            FlintHairline()
        }
    }

    @ViewBuilder private var notes: some View {
        if let problem = viewModel.problem {
            note(problem, icon: .alert, color: FlintColor.danger, id: "composer.problem")
        }
        if viewModel.fields.track, let blocker = viewModel.receiptBlocker {
            note(blocker, icon: .eye, color: FlintColor.fg2, id: "composer.receiptNote")
        }
    }

    private func note(_ text: String, icon: FlintIcon, color: Color, id: String) -> some View {
        HStack(alignment: .top, spacing: FlintMetrics.Space.s2) {
            FlintIconView(icon: icon, size: 14, color: color)
            Text(text).flintText(.data, color: FlintColor.fg).frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    // MARK: Helpers

    private func binding(_ path: WritableKeyPath<ComposerFields, [Address]>) -> Binding<[Address]> {
        Binding(get: { viewModel.fields[keyPath: path] }, set: { value in viewModel.edit { $0[keyPath: path] = value } })
    }

    private func suggest(_ prefix: String) async -> [Contact] {
        (try? await viewModel.model.suggestContacts(prefix: prefix, limit: 8)) ?? []
    }

    private func reveal(_ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).flintText(.label, color: FlintColor.fg2)
                .frame(minWidth: FlintMetrics.Size.touch - 8, minHeight: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle())
        .accessibilityIdentifier(id)
    }
}

/// Files attached to the draft, one row each with a remove button.
struct ComposerAttachments: View {
    let attachments: [DraftAttachment]
    let remove: (DraftAttachment) -> Void

    var body: some View {
        if !attachments.isEmpty {
            VStack(spacing: 0) {
                ForEach(attachments) { attachment in
                    HStack(spacing: FlintMetrics.Space.s3) {
                        FlintIconView(icon: .paperclip, size: 16, color: FlintColor.fg3)
                        Text(attachment.filename).flintText(.body).lineLimit(1).truncationMode(.middle)
                        Text(FlintFormat.fileSize(attachment.size)).flintText(.data, color: FlintColor.fg3)
                        Spacer(minLength: 0)
                        FlintIconButton(
                            icon: .close, label: String(localized: "Remove \(attachment.filename)", table: "Composer"),
                            identifier: "composer.attachment.remove.\(attachment.id)") { remove(attachment) }
                    }
                    .padding(.leading, FlintMetrics.Space.s4)
                    .padding(.trailing, FlintMetrics.Space.s2)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("composer.attachment.\(attachment.id)")
                    FlintHairline()
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("composer.attachments")
        }
    }
}
