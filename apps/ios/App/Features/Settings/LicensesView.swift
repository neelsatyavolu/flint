import SwiftUI

/// The open-source projects Flint ships, one row each; a row opens the copyright line and license text.
struct LicensesView: View {
    private let catalog = LicenseCatalog.load()

    var body: some View {
        SettingsPage(title: sl("Licenses"), identifier: "licenses") {
            Text("Flint is MIT licensed and ships with these open-source projects. Each page has the copyright line and license text.", tableName: "Settings")
                .flintText(.body, color: FlintColor.fg3).padding(FlintMetrics.Space.s4)
            FlintHairline()
            if let catalog {
                ForEach(catalog.items) { item in
                    SettingsLinkRow(
                        title: item.name, detail: item.license, destination: SettingsDestination.license(item.name),
                        identifier: "settings.licenses.\(item.name)")
                }
            } else {
                Text("The license list could not be read.", tableName: "Settings").flintText(.body, color: FlintColor.danger)
                    .padding(FlintMetrics.Space.s4).accessibilityIdentifier("settings.licenses.missing")
            }
        }
    }
}

struct LicenseDetailView: View {
    let name: String
    private let catalog = LicenseCatalog.load()

    var body: some View {
        SettingsPage(title: name, identifier: "license") {
            if let catalog, let item = catalog.item(named: name) {
                VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
                    Text(item.version.isEmpty ? item.license : "\(item.license) · \(item.version)").flintText(.data, color: FlintColor.fg2)
                    Text(item.copyright).flintText(.body).accessibilityIdentifier("settings.license.copyright")
                    Text(catalog.text(for: item)).flintText(.data, color: FlintColor.fg2).textSelection(.enabled)
                        .accessibilityIdentifier("settings.license.text")
                    if !item.notice.isEmpty {
                        Text("Notice", tableName: "Settings").flintText(.label)
                        Text(item.notice).flintText(.data, color: FlintColor.fg2).textSelection(.enabled)
                    }
                }
                .padding(FlintMetrics.Space.s4)
            }
        }
    }
}
