import Foundation
import WebKit

/// Serves `flint-attachment://<id>` for inline (cid) images, from the attachment cache through the service. Only image types
/// are served, so a hostile attachment can never come back as a document or script.
///
/// WebKit raises an Objective-C exception when a task it has stopped is messaged. A task is therefore messaged only while it is
/// in `active`, checked on the main actor right before each call, and `webView(_:stop:)` takes it out of `active`.
@MainActor
final class AttachmentSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "flint-attachment"

    typealias Loader = @Sendable (Int) async throws -> Data

    private let load: Loader
    private var types: [Int: String]
    private var active: Set<ObjectIdentifier> = []
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
        active.insert(key)
        tasks[key] = Task { [weak self] in
            let result: Result<Data, Error>
            do { result = .success(try await load(id)) } catch { result = .failure(error) }
            self?.deliver(result, to: urlSchemeTask, key: key, url: url, type: type)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        active.remove(key)
        tasks.removeValue(forKey: key)?.cancel()
    }

    /// Replies to the task unless the web view stopped it while the image was loading.
    private func deliver(_ result: Result<Data, Error>, to task: any WKURLSchemeTask, key: ObjectIdentifier, url: URL, type: String) {
        tasks[key] = nil
        guard active.remove(key) != nil else { return }
        switch result {
        case .success(let data):
            task.didReceive(URLResponse(url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
            task.didReceive(data)
            task.didFinish()
        case .failure:
            task.didFailWithError(URLError(.cannotLoadFromNetwork))
        }
    }
}
