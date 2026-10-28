import SwiftUI

/// "Nothing here" for a list or a pane: a quiet icon, a title, one line of help and an optional action.
struct FlintEmptyState: View {
    let icon: FlintIcon
    let title: String
    var message: String?
    var actionTitle: String?
    var identifier = "shared.empty"
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: FlintMetrics.Space.s3) {
            FlintIconView(icon: icon, size: 24, color: FlintColor.fg4)
            Text(title).flintText(.title).multilineTextAlignment(.center)
            if let message {
                Text(message).flintText(.body, color: FlintColor.fg3).multilineTextAlignment(.center)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(FlintButtonStyle(kind: .ghost))
                    .padding(.top, FlintMetrics.Space.s2)
                    .accessibilityIdentifier("\(identifier).action")
            }
        }
        .frame(maxWidth: 320)
        .padding(FlintMetrics.Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}
