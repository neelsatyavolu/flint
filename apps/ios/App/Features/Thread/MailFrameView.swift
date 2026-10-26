import FlintModel
import SwiftUI
import WebKit

/// One HTML page of a message in the reader web view. It waits for the content rule lists to compile before loading, and falls
/// back to the plain text when they cannot, so mail never loads without its blockers.
struct MailFrameView: View {
    let html: String
    let message: MessageView
    let appearance: MailAppearance
    let allowImages: Bool
    let vm: ThreadModel
    let identifier: String
    var reportsVerdict = true

    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var scheme
    @State private var rules: RuleState = .loading
    @State private var height: CGFloat = 24

    private enum RuleState {
        case loading
        case ready([WKContentRuleList])
        case failed
    }

    var body: some View {
        Group {
            switch rules {
            case .loading:
                Color.clear
            case .ready(let lists):
                ReaderWebView(
                    document: document, ruleLists: lists, loadAttachment: loader, height: $height,
                    onVerdict: { if reportsVerdict { vm.record(verdict: $0, for: message.id) } },
                    onLink: { href, text in route(href, text) })
            case .failed:
                Text(message.text ?? message.snippet).flintText(.prose).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(height: isFailed ? nil : height)
        .frame(maxWidth: .infinity)
        .task(id: allowImages) { await prepare() }
        .accessibilityIdentifier(identifier)
    }

    private var isFailed: Bool {
        if case .failed = rules { return true }
        return false
    }

    private var document: ReaderDocument {
        ReaderDocument(
            html: html, appearance: appearance, palette: ReaderPalette.make(dark: scheme == .dark),
            attachmentTypes: Dictionary(message.attachments.map { ($0.id, $0.contentType) }, uniquingKeysWith: { first, _ in first }),
            allowImages: allowImages)
    }

    private var loader: AttachmentSchemeHandler.Loader {
        let service = app.service
        return { id in
            guard let service else { throw URLError(.cancelled) }
            return try await service.attachmentData(id)
        }
    }

    private func prepare() async {
        let endpoint = app.settings?.receipts.endpoint
        if let lists = await ReaderRuleStore.shared.lists(allowImages: allowImages, receiptsEndpoint: endpoint) {
            rules = .ready(lists)
        } else {
            rules = .failed
        }
    }

    private func route(_ href: String, _ text: String) {
        if let address = vm.route(href: href, text: text) { app.startCompose(.new(to: [Address(address: address)])) }
    }
}
