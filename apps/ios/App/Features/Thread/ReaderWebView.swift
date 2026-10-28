import SwiftUI
import WebKit

/// One message page in a locked-down `WKWebView` (DESIGN-NOTES "Reader security"): non-persistent data store, no page
/// JavaScript, content rule lists attached before the first load, `baseURL: nil`, every navigation cancelled, links routed to
/// the app. The web view never scrolls; its height follows the page.
struct ReaderWebView: UIViewRepresentable {
    let document: ReaderDocument
    let ruleLists: [WKContentRuleList]
    let loadAttachment: AttachmentSchemeHandler.Loader
    @Binding var height: CGFloat
    var onVerdict: (Bool) -> Void
    var onLink: (String, String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.defaultWebpagePreferences.allowsContentJavaScript = false
        config.dataDetectorTypes = []
        config.allowsInlineMediaPlayback = false
        config.mediaTypesRequiringUserActionForPlayback = .all
        coordinator.scheme = AttachmentSchemeHandler(types: document.attachmentTypes, load: loadAttachment)
        config.setURLSchemeHandler(coordinator.scheme, forURLScheme: AttachmentSchemeHandler.scheme)
        let controller = config.userContentController
        ruleLists.forEach(controller.add)
        let textSize = Int((Self.zoom(for: context.environment.dynamicTypeSize) * 100).rounded())
        ReaderScript.userScripts(textSizePercent: textSize).forEach(controller.addUserScript)
        controller.add(coordinator.messageProxy, contentWorld: ReaderScript.world, name: ReaderScript.handlerName)

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.isScrollEnabled = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.backgroundColor = .clear
        web.navigationDelegate = coordinator
        web.allowsLinkPreview = false
        web.isInspectable = false
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.parent = self
        coordinator.scheme?.update(types: document.attachmentTypes)
        guard coordinator.loadedKey != document.key else { return }
        coordinator.loadedKey = document.key
        web.loadHTMLString(document.page, baseURL: nil)
    }

    /// The message text follows the reader's Dynamic Type setting the way body text does, capped at twice the size so wide
    /// newsletters still lay out. Applied as `-webkit-text-size-adjust`, which scales text without zooming the layout.
    static func zoom(for size: DynamicTypeSize) -> CGFloat {
        let traits = UITraitCollection(preferredContentSizeCategory: UIContentSizeCategory(size))
        let scale = UIFontMetrics(forTextStyle: .body).scaledValue(for: 100, compatibleWith: traits) / 100
        return min(2, max(1, (scale * 20).rounded() / 20))
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeAllScriptMessageHandlers()
        web.configuration.userContentController.removeAllUserScripts()
        web.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: ReaderWebView?
        var loadedKey: String?
        var scheme: AttachmentSchemeHandler?
        lazy var messageProxy = MessageProxy { [weak self] message in self?.receive(message) }

        private func receive(_ message: ReaderScript.Message) {
            guard let parent else { return }
            switch message {
            case .height(let value): if abs(parent.height - value) > 0.5 { parent.height = value }
            case .verdict(let adaptable): parent.onVerdict(adaptable)
            case .link(let href, let text): parent.onLink(href, text)
            }
        }

        /// The first load is the only navigation allowed. A tap that got past the page script is handed to the app.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
                parent?.onLink(url.absoluteString, "")
                return .cancel
            }
            let isInitial = navigationAction.navigationType == .other && navigationAction.request.url?.scheme == "about"
            return isInitial ? .allow : .cancel
        }
    }

    /// Breaks the retain cycle between the user content controller and the coordinator.
    @MainActor
    final class MessageProxy: NSObject, WKScriptMessageHandler {
        private let handle: (ReaderScript.Message) -> Void
        init(_ handle: @escaping (ReaderScript.Message) -> Void) { self.handle = handle }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let parsed = ReaderScript.Message(message.body) else { return }
            handle(parsed)
        }
    }
}
