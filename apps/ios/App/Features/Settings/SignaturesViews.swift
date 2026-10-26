import FlintModel
import SwiftUI

/// Signatures list, with a link on to templates.
struct SignaturesPage: View {
    @Environment(AppModel.self) private var model
    @Environment(SettingsLibrary.self) private var library

    var body: some View {
        SettingsPage(title: sl("Signatures"), identifier: "signatures") {
            SettingsGroup(title: sl("Signatures"), note: sl("Added to the end of new mail and replies. Choose which accounts use each one.")) {
                ForEach(library.signatures) { signature in
                    SettingsLinkRow(
                        title: signature.name.isEmpty ? sl("Untitled") : signature.name, detail: usage(signature),
                        destination: SettingsDestination.signature(signature.id), identifier: "settings.signature.\(signature.id)")
                }
                if library.isLoaded, library.signatures.isEmpty {
                    Text("No signatures yet.", tableName: "Settings").flintText(.body, color: FlintColor.fg3)
                        .padding(FlintMetrics.Space.s4)
                }
                SettingsLinkRow(icon: .plus, title: sl("New signature"), destination: SettingsDestination.signature(nil), identifier: "settings.signature.new")
            }
            SettingsGroup(title: sl("Templates")) {
                SettingsLinkRow(
                    icon: .fileText, title: sl("Templates"), value: "\(library.templates.count)",
                    destination: SettingsDestination.templates, identifier: "settings.templates.open")
            }
        }
    }

    private func usage(_ signature: Signature) -> String {
        var parts: [String] = []
        parts.append(signature.accountIds.isEmpty ? sl("All accounts") : signature.accountIds.map(model.accountName).joined(separator: ", "))
        if signature.defaultNew { parts.append(sl("Default for new mail")) }
        if signature.defaultReply { parts.append(sl("Default for replies")) }
        return parts.joined(separator: " · ")
    }
}

struct SignatureEditorView: View {
    let signatureId: Int?
    @Environment(AppModel.self) private var model
    @Environment(SettingsLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var draft: SignatureDraft?
    @State private var busy = false

    var body: some View {
        SettingsPage(title: signatureId == nil ? sl("New signature") : sl("Signature"), identifier: "signature") {
            if draft != nil { editor }
        }
        .task(id: library.isLoaded) { loadDraft() }
    }

    private func loadDraft() {
        guard draft == nil, library.isLoaded else { return }
        if let signatureId, let existing = library.signatures.first(where: { $0.id == signatureId }) {
            draft = SignatureDraft(existing)
        } else if signatureId == nil {
            draft = SignatureDraft()
        }
    }

    @ViewBuilder private var editor: some View {
        let binding = Binding(get: { draft ?? SignatureDraft() }, set: { draft = $0 })
        SettingsField(label: sl("Name"), text: binding.name, prompt: sl("Work"), identifier: "settings.signature.name")
        SettingsGroup(title: sl("Use with")) {
            SettingsToggleRow(
                title: sl("All accounts"), isOn: Binding(get: { binding.wrappedValue.accountIds.isEmpty }, set: { if $0 { binding.wrappedValue.accountIds = [] } }),
                identifier: "settings.signature.allAccounts")
            ForEach(model.accounts) { account in
                SettingsToggleRow(title: account.email, isOn: accountBinding(account.id, binding), identifier: "settings.signature.account.\(account.id)")
            }
        }
        SettingsTextBox(label: sl("Signature"), text: binding.text, identifier: "settings.signature.text")
        Text(String(format: sl("Formatting from the Mac app is kept until you change the text here. Editing on %@ saves plain text."), ThisDevice.name))
            .flintText(.body, color: FlintColor.fg3)
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.top, FlintMetrics.Space.s2)
        SettingsGroup(title: sl("Default")) {
            SettingsToggleRow(title: sl("Use for new mail"), isOn: binding.defaultNew, identifier: "settings.signature.defaultNew")
            SettingsToggleRow(title: sl("Use for replies"), isOn: binding.defaultReply, identifier: "settings.signature.defaultReply")
        }
        actions(binding.wrappedValue)
    }

    private func accountBinding(_ id: AccountID, _ draft: Binding<SignatureDraft>) -> Binding<Bool> {
        Binding(
            get: { draft.wrappedValue.accountIds.contains(id) },
            set: { on in
                let rest = draft.wrappedValue.accountIds.filter { $0 != id }
                draft.wrappedValue.accountIds = on ? rest + [id] : rest
            })
    }

    private func actions(_ current: SignatureDraft) -> some View {
        VStack(spacing: FlintMetrics.Space.s3) {
            SettingsButton(title: sl("Save"), kind: .primary, disabled: !current.canSave || busy, identifier: "settings.signature.save") {
                busy = true
                Task {
                    defer { busy = false }
                    if await library.save(current.signature()) { dismiss() }
                }
            }
            if let id = current.id {
                SettingsButton(title: sl("Delete"), kind: .danger, disabled: busy, identifier: "settings.signature.delete") {
                    Task { if await library.deleteSignature(id: id) { dismiss() } }
                }
            }
        }
        .padding(FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s2)
    }
}

struct TemplatesView: View {
    @Environment(SettingsLibrary.self) private var library

    var body: some View {
        SettingsPage(title: sl("Templates"), identifier: "templates") {
            SettingsGroup(title: sl("Templates"), note: sl("Reusable subjects and bodies. Insert one from the composer.")) {
                ForEach(library.templates) { template in
                    SettingsLinkRow(
                        title: template.name.isEmpty ? sl("Untitled") : template.name, detail: template.subject.isEmpty ? nil : template.subject,
                        destination: SettingsDestination.template(template.id), identifier: "settings.template.\(template.id)")
                }
                if library.isLoaded, library.templates.isEmpty {
                    Text("No templates yet.", tableName: "Settings").flintText(.body, color: FlintColor.fg3)
                        .padding(FlintMetrics.Space.s4)
                }
                SettingsLinkRow(icon: .plus, title: sl("New template"), destination: SettingsDestination.template(nil), identifier: "settings.template.new")
            }
        }
    }
}

struct TemplateEditorView: View {
    let templateId: Int?
    @Environment(SettingsLibrary.self) private var library
    @Environment(\.dismiss) private var dismiss
    @State private var draft: TemplateDraft?
    @State private var busy = false

    var body: some View {
        SettingsPage(title: templateId == nil ? sl("New template") : sl("Template"), identifier: "template") {
            if draft != nil { editor }
        }
        .task(id: library.isLoaded) { loadDraft() }
    }

    private func loadDraft() {
        guard draft == nil, library.isLoaded else { return }
        if let templateId, let existing = library.templates.first(where: { $0.id == templateId }) {
            draft = TemplateDraft(existing)
        } else if templateId == nil {
            draft = TemplateDraft()
        }
    }

    @ViewBuilder private var editor: some View {
        let binding = Binding(get: { draft ?? TemplateDraft() }, set: { draft = $0 })
        SettingsField(label: sl("Name"), text: binding.name, prompt: sl("Intro call"), identifier: "settings.template.name")
        SettingsField(label: sl("Subject"), text: binding.subject, prompt: sl("Optional"), identifier: "settings.template.subject")
        SettingsTextBox(label: sl("Template body"), text: binding.text, identifier: "settings.template.text")
        let current = binding.wrappedValue
        VStack(spacing: FlintMetrics.Space.s3) {
            SettingsButton(title: sl("Save"), kind: .primary, disabled: !current.canSave || busy, identifier: "settings.template.save") {
                busy = true
                Task {
                    defer { busy = false }
                    if await library.save(current.template()) { dismiss() }
                }
            }
            if let id = current.id {
                SettingsButton(title: sl("Delete"), kind: .danger, disabled: busy, identifier: "settings.template.delete") {
                    Task { if await library.deleteTemplate(id: id) { dismiss() } }
                }
            }
        }
        .padding(FlintMetrics.Space.s4)
        .padding(.top, FlintMetrics.Space.s2)
    }
}
