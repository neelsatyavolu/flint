import FlintModel
import SwiftUI

/// PLACEHOLDER (track 3E replaces this file). The shell presents it as a sheet for `Route.compose`; the request it was
/// opened with is in `AppModel.presented`.
struct ComposerRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "New message", table: "Composer"), identifier: "composer") { model.navigate(to: .dismiss) }
            FlintEmptyState(
                icon: .compose, title: String(localized: "Composer", table: "Composer"),
                message: String(localized: "This screen is a placeholder.", table: "Composer"), identifier: "composer.placeholder")
        }
        .accessibilityIdentifier("composer.root")
    }
}
