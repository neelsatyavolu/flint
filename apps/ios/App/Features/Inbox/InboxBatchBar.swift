import FlintModel
import SwiftUI

/// The bar at the bottom while conversations are selected: one icon per action that fits the list, as on the desktop's batch bar.
struct InboxBatchBar: View {
    let ops: [InboxOp]
    let count: Int
    let perform: (InboxOp) -> Void

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ops, id: \.self) { op in
                FlintIconButton(
                    icon: op.icon, label: op.title, color: op.isDestructive ? FlintColor.danger : FlintColor.fg2,
                    identifier: "inbox.batch.\(op.identifier)") { perform(op) }
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, FlintMetrics.Space.s2)
        .frame(minHeight: FlintMetrics.Size.bar)
        .background(FlintColor.plane2)
        .overlay(alignment: .top) { FlintHairline() }
        .disabled(count == 0)
        .opacity(count == 0 ? 0.5 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("inbox.batch")
    }
}

/// The quick filter: All, Unread, Attachments as flat segments under the bar.
struct InboxFilterBar: View {
    @Binding var filter: InboxFilter

    var body: some View {
        // Scrolls sideways when large text makes the segments wider than the screen; a segment never wraps.
        ScrollView(.horizontal, showsIndicators: false) { segments }
            .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
            .background(FlintColor.plane1)
            .overlay(alignment: .bottom) { FlintHairline() }
    }

    private var segments: some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            ForEach(InboxFilter.allCases) { option in
                Button { filter = option } label: {
                    Text(option.title)
                        .flintText(.label, color: filter == option ? FlintColor.accentFg : FlintColor.fg2)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, FlintMetrics.Space.s3)
                        .frame(minHeight: 32)
                        .background(filter == option ? FlintColor.accent : .clear, in: shape)
                        .overlay(shape.stroke(filter == option ? .clear : FlintColor.lineStrong, lineWidth: 1))
                        .contentShape(shape)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(filter == option ? .isSelected : [])
                .accessibilityIdentifier("inbox.filter.\(option.rawValue)")
            }
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .padding(.vertical, FlintMetrics.Space.s2)
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control) }
}

/// A date group label in the list: Geist Mono, upper case.
struct InboxSectionHeader: View {
    let label: String

    var body: some View {
        Text(label)
            .flintText(.label)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.top, FlintMetrics.Space.s3)
            .padding(.bottom, FlintMetrics.Space.s1)
            .background(FlintColor.plane1)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("inbox.section")
    }
}

/// End of the list: older mail on the server, a retry, or nothing.
struct InboxFooter: View {
    let hasMore: Bool
    let olderOnServer: Bool
    let loadingOlder: Bool
    let failed: Bool
    let loadMore: () -> Void
    let loadOlder: () -> Void

    var body: some View {
        Group {
            if failed {
                line(String(localized: "Couldn't load more.", table: "Inbox"), action: String(localized: "Try again", table: "Inbox"), run: hasMore ? loadMore : loadOlder)
            } else if hasMore {
                Color.clear.frame(height: 1).onAppear(perform: loadMore)
            } else if loadingOlder {
                line(String(localized: "Loading older mail", table: "Inbox"))
            } else if olderOnServer {
                line(String(localized: "Older mail isn't on this device yet", table: "Inbox"), action: String(localized: "Load more", table: "Inbox"), run: loadOlder)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityIdentifier("inbox.footer")
    }

    private func line(_ text: String, action: String? = nil, run: (() -> Void)? = nil) -> some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            Text(text).flintText(.body, color: FlintColor.fg3)
            if let action, let run {
                Button(action: run) {
                    Text(action).flintText(.bodyStrong, color: FlintColor.accent).frame(minHeight: FlintMetrics.Size.touch)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("inbox.footer.action")
            }
        }
        .padding(.horizontal, FlintMetrics.Space.s4)
        .frame(minHeight: FlintMetrics.Size.touch)
    }
}
