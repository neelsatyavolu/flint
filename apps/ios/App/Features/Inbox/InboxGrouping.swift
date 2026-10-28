import FlintModel
import Foundation

/// A run of conversations under one date label (TODAY, YESTERDAY, THIS WEEK, a month).
struct InboxSection: Identifiable, Equatable {
    let id: String
    let label: String
    let items: [ThreadListItem]
}

enum InboxGrouping {
    /// Groups a sorted list into consecutive runs that share a label, as the desktop list does.
    static func sections(_ items: [ThreadListItem], time: FlintTime = .current, now: Date = Date()) -> [InboxSection] {
        var sections: [InboxSection] = []
        var label = ""
        var run: [ThreadListItem] = []
        func flush() {
            if !run.isEmpty { sections.append(InboxSection(id: "\(sections.count):\(label)", label: label, items: run)) }
            run = []
        }
        for item in items {
            let itemLabel = time.dateGroupLabel(item.lastDate, now: now)
            if itemLabel != label {
                flush()
                label = itemLabel
            }
            run.append(item)
        }
        flush()
        return sections
    }
}
