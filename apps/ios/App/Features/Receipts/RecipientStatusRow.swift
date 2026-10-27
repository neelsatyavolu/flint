import FlintModel
import SwiftUI

/// One recipient: avatar, name and an honest status line. The dot carries the tone; the words carry the meaning, so the
/// line stays readable without color.
struct RecipientStatusRow: View {
    let recipient: ReceiptRecipient
    var detail: ReceiptDetail?
    let identifier: String

    var body: some View {
        let name = FlintFormat.displayName(Address(name: recipient.name, address: recipient.email))
        let line = ReceiptStatusText.statusLine(recipient, detail: detail)
        HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
            FlintAvatar(address: recipient.email, name: recipient.name, size: .s24)
            VStack(alignment: .leading, spacing: 2) {
                Text(name).flintText(.bodyMedium).lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s2) {
                    Circle().fill(dotColor).frame(width: 6, height: 6).accessibilityHidden(true)
                    Text(line).flintText(.data).fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: FlintMetrics.Size.touch - 8, alignment: .top)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), \(line)")
        .accessibilityIdentifier(identifier)
    }

    private var dotColor: Color {
        switch ReceiptStatusText.tone(recipient.status) {
        case .ok: FlintColor.ok
        case .warn: FlintColor.warn
        case .muted: FlintColor.fg4
        }
    }
}

/// The check beside a tracked row or message: an eye in the tone of the whole message, and "2/3" when there are several people.
struct ReceiptMarkerView: View {
    let marker: ReceiptStatusText.Marker
    let identifier: String

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s1) {
            FlintIconView(icon: .eye, size: 14, color: color)
            if !marker.text.isEmpty { Text(marker.text).flintText(.data) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(marker.label)
        .accessibilityIdentifier(identifier)
    }

    private var color: Color {
        switch marker.tone {
        case .ok: FlintColor.accent
        case .warn: FlintColor.warn
        case .muted: FlintColor.fg3
        }
    }
}

/// Every event behind a receipt, newest first. Events the filters did not count are dimmed and say so.
struct ReceiptTimelineView: View {
    let events: [ReceiptEvent]
    let identifier: String

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            if events.isEmpty {
                Text("No events yet.", tableName: "Receipts").flintText(.data, color: FlintColor.fg2)
            } else {
                ForEach(Array(events.sorted { $0.at > $1.at }.enumerated()), id: \.offset) { _, event in
                    HStack(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s3) {
                        Text(ReceiptStatusText.time(event.at)).flintText(.data, color: FlintColor.fg2)
                        Text("\(FlintFormat.displayName(Address(address: event.email))) · \(ReceiptStatusText.eventLine(event))")
                            .flintText(.data, color: event.counted ? FlintColor.fg : FlintColor.fg2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}
