import FlintModel
import SwiftUI

/// A strip at the top of a list or pane that says what went wrong, with an optional retry. Use it for errors that leave the
/// screen usable; use a toast for the result of an action.
struct ErrorBanner: View {
    let message: String
    var retryTitle: String?
    var identifier = "shared.errorBanner"
    var retry: (() -> Void)?

    init(error: any Error, identifier: String = "shared.errorBanner", retry: (() -> Void)? = nil) {
        self.message = FlintErrorText.message(for: error)
        self.retryTitle = retry == nil ? nil : String(localized: "Try again", table: "Shared")
        self.identifier = identifier
        self.retry = retry
    }

    init(message: String, retryTitle: String? = nil, identifier: String = "shared.errorBanner", retry: (() -> Void)? = nil) {
        self.message = message
        self.retryTitle = retryTitle
        self.identifier = identifier
        self.retry = retry
    }

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s3) {
            FlintIconView(icon: .alert, size: 16, color: FlintColor.danger)
            Text(message).flintText(.body).frame(maxWidth: .infinity, alignment: .leading)
            if let retry, let retryTitle {
                Button(action: retry) {
                    Text(retryTitle)
                        .flintText(.bodyStrong, color: FlintColor.accent)
                        .frame(minHeight: FlintMetrics.Size.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(FlintPressStyle())
                .accessibilityIdentifier("\(identifier).retry")
            }
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s1)
        .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch)
        .background(FlintColor.plane2)
        .overlay(alignment: .bottom) { FlintHairline() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}
