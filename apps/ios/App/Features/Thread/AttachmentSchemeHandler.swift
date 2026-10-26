import Foundation
import WebKit

/// Serves `flint-attachment://<id>` for inline (cid) images, from the attachment cache through the service. Only image types
/// are served, so a hostile attachment can never come back as a document or script.
@MainActor
final class AttachmentSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "flint-attachment"

    typealias Loader = @Sendable (Int) async throws -> Data

    private let load: Loader
    private var types: [Int: String]
    private var tasks: [ObjectIdentifier: Task<Void, Never>] = [:]

    init(types: [Int: String], load: @escaping Loader) {
        self.types = types
        self.load = load
    }

    func update(types: [Int: String]) { self.types = types }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        guard let url = urlSchemeTask.request.url, let host = url.host, let id = Int(host),
              let type = types[id], type.lowercased().hasPrefix("image/") else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        let load = self.load
        tasks[key] = Task { [weak self] in
            do {
                let data = try await load(id)
                try Task.checkCancellation()
                let response = URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil)
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didReceive(data)
                urlSchemeTask.didFinish()
            } catch is CancellationError {
                // The web view stopped the task; it must not be touched again.
            } catch {
                urlSchemeTask.didFailWithError(URLError(.cannotLoadFromNetwork))
            }
            self?.tasks[key] = nil
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        tasks[key]?.cancel()
        tasks[key] = nil
    }
}
