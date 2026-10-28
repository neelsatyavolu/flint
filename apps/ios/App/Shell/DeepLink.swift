import Foundation

/// URLs the app is opened with. Parsing is pure so it is unit tested.
enum DeepLink: Equatable, Sendable {
    /// `flint://pair#<base64url JSON>` from the Mac's QR code (DESIGN-NOTES section 7). Payload is the fragment.
    case pair(payload: String)
    /// Redirect of the Google iOS OAuth client: `com.googleusercontent.apps.<id>:/oauth2redirect?code=...`.
    case oauthCallback(URL)
    case unknown

    static let flintScheme = "flint"
    static let googleScheme = "com.googleusercontent.apps.617596563618-84523hu1pellgad03t263u2mqig2i45i"

    static func parse(_ url: URL) -> DeepLink {
        switch url.scheme?.lowercased() {
        case flintScheme:
            guard url.host?.lowercased() == "pair", let fragment = url.fragment, !fragment.isEmpty else { return .unknown }
            return .pair(payload: fragment)
        case googleScheme:
            return .oauthCallback(url)
        default:
            return .unknown
        }
    }
}
