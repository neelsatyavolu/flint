import SwiftUI

/// "Check now" and the background diagnostics: when iOS last woke Flint, how it went, and how often it does.
struct BackgroundChecksGroup: View {
    @Environment(AppModel.self) private var model
    @Binding var checking: Bool

    var body: some View {
        SettingsGroup(
            title: nl("Background checks"),
            note: nl("iOS decides when Flint can check for mail in the background. Expect gaps of tens of minutes to hours, and nothing after you force-quit Flint or in Low Power Mode.")) {
            SettingsRowLayout(icon: .refresh, title: nl("Check now"), detail: nl("Syncs your accounts and alerts for anything new.")) {
                Button {
                    checking = true
                    Task {
                        await model.checkNow()
                        checking = false
                    }
                } label: { Text(checking ? nl("Checking") : nl("Check now")) }
                    .buttonStyle(FlintButtonStyle(kind: .secondary))
                    .disabled(checking)
                    .accessibilityIdentifier("settings.notifications.checkNow")
            }
            summaryRows
            ForEach(model.diagnostics.runs.prefix(5)) { run in runRow(run) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings.notifications.diagnostics")
    }

    @ViewBuilder private var summaryRows: some View {
        let diagnostics = model.diagnostics
        SettingsRowLayout(title: nl("Last background run")) {
            Text(NotificationsText.lastRun(diagnostics)).flintText(.data, color: FlintColor.fg2)
                .accessibilityIdentifier("settings.notifications.lastRun")
        }
        SettingsRowLayout(title: nl("Background runs on record")) {
            Text("\(diagnostics.systemRuns.count)").flintText(.data, color: FlintColor.fg2)
                .accessibilityIdentifier("settings.notifications.runCount")
        }
        if let gap = diagnostics.averageGapMinutes {
            SettingsRowLayout(title: nl("Average gap between runs")) {
                Text(NotificationsText.gap(gap)).flintText(.data, color: FlintColor.fg2)
                    .accessibilityIdentifier("settings.notifications.averageGap")
            }
        }
    }

    private func runRow(_ run: BackgroundRunRecord) -> some View {
        SettingsRowLayout(
            title: "\(NotificationsText.kind(run.kind)), \(NotificationsText.result(run))",
            detail: "\(run.startedAt.formatted(date: .abbreviated, time: .shortened)). \(NotificationsText.counts(run))") {
            Text("\(run.durationMs) ms").flintText(.data, color: FlintColor.fg3)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("settings.notifications.run.\(run.id.uuidString)")
    }
}
