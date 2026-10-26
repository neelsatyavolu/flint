import FlintModel
import SwiftUI

/// PLACEHOLDER (track 3G replaces this file). Presented as a sheet for `Route.settings`; lists the accounts from `AppModel`.
struct SettingsRoot: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Settings", table: "Settings"), identifier: "settings") { model.navigate(to: .dismiss) }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Text("Accounts", tableName: "Settings")
                        .flintText(.label, color: FlintColor.fg3)
                        .padding(FlintMetrics.Space.s4)
                    ForEach(model.accounts) { account in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(account.name).flintText(.bodyMedium)
                            Text(account.email).flintText(.data, color: FlintColor.fg3)
                        }
                        .padding(.horizontal, FlintMetrics.Space.s4)
                        .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch, alignment: .leading)
                        .accessibilityIdentifier("settings.account.\(account.id)")
                    }
                }
            }
        }
        .background(FlintColor.plane1)
        .accessibilityIdentifier("settings.root")
    }
}
