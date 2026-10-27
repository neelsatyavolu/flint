import FlintModel
import Foundation

func nl(_ key: String.LocalizationValue) -> String { String(localized: key, table: "Notifications") }

/// Text for the Notifications page, kept apart from the views so it can be tested.
enum NotificationsText {
    static func result(_ record: BackgroundRunRecord) -> String {
        switch record.result {
        case .completed: nl("Completed")
        case .failed: record.errorCode.map { nl("Failed (\($0))") } ?? nl("Failed")
        case .expired: nl("Ran out of time")
        }
    }

    static func kind(_ kind: BackgroundRunRecord.Kind) -> String {
        switch kind {
        case .refresh: nl("Refresh")
        case .processing: nl("Processing")
        case .checkNow: nl("Check now")
        case .notificationAction: nl("Notification action")
        }
    }

    /// "2 new conversations, 1 alert" or "Nothing new".
    static func counts(_ record: BackgroundRunRecord) -> String {
        if record.newMail == 0, record.alerts == 0 { return nl("Nothing new") }
        let mail = record.newMail == 1 ? nl("1 new conversation") : nl("\(record.newMail) new conversations")
        let alerts = record.alerts == 1 ? nl("1 alert") : nl("\(record.alerts) alerts")
        return "\(mail), \(alerts)"
    }

    static func lastRun(_ diagnostics: BackgroundDiagnostics, now: Date = Date()) -> String {
        guard let run = diagnostics.lastSystemRun else { return nl("No background run yet") }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter.localizedString(for: run.startedAt, relativeTo: now)
    }

    static func gap(_ minutes: Int) -> String {
        minutes >= 120 ? nl("\(minutes / 60) hours") : nl("\(minutes) min")
    }

    /// Settings patch value for the accounts that are switched off, after flipping one.
    static func disabledAccounts(_ current: [AccountID], toggling id: AccountID, enabled: Bool) -> [AccountID] {
        var next = current.filter { $0 != id }
        if !enabled { next.append(id) }
        return next
    }
}
