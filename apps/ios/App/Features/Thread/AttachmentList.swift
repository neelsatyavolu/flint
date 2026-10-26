import FlintModel
import SwiftUI

/// The files attached to a message, one 44 pt row each. Tapping one downloads it and opens Quick Look.
struct AttachmentList: View {
    let attachments: [AttachmentInfo]
    let onOpen: (AttachmentInfo) -> Void

    var body: some View {
        if !attachments.isEmpty {
            VStack(spacing: FlintMetrics.Space.s2) {
                ForEach(attachments) { attachment in
                    Button { onOpen(attachment) } label: {
                        HStack(spacing: FlintMetrics.Space.s3) {
                            FlintIconView(icon: Self.icon(for: attachment.contentType), size: 18, color: FlintColor.fg2)
                            Text(attachment.filename).flintText(.bodyMedium).lineLimit(1).truncationMode(.middle)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Text(FlintFormat.fileSize(attachment.size)).flintText(.data, color: FlintColor.fg3)
                        }
                        .padding(.horizontal, FlintMetrics.Space.s3)
                        .frame(minHeight: FlintMetrics.Size.touch)
                        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.line, lineWidth: 1))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(FlintPressStyle())
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(attachment.filename), \(FlintFormat.fileSize(attachment.size))")
                    .accessibilityHint(String(localized: "Opens a preview", table: "Thread"))
                    .accessibilityIdentifier("thread.attachment.\(attachment.id)")
                }
            }
        }
    }

    static func icon(for contentType: String) -> FlintIcon {
        let type = contentType.lowercased()
        if type.hasPrefix("image/") { return .image }
        if type.hasPrefix("text/") || type == "application/pdf" { return .fileText }
        return .paperclip
    }
}
