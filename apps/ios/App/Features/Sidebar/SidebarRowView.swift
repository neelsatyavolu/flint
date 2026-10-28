import SwiftUI

/// One tappable row of the sidebar. Flat: the selected row gets the soft accent fill and a 2 pt accent bar, as in the list.
struct SidebarRowView: View {
    enum Leading {
        case icon(FlintIcon)
        case avatar(address: String, name: String)
    }

    let leading: Leading
    let title: String
    var count = 0
    var isSelected = false
    /// 0 for a top-level row, 1 for a child under Inbox or an account label.
    var depth = 0
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: FlintMetrics.Space.s3) {
                leadingView.frame(width: 24, alignment: .center)
                Text(title)
                    .flintText(isSelected ? .bodyStrong : .body)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: FlintMetrics.Space.s2)
                if count > 0 {
                    Text(count.formatted())
                        .flintText(.data, color: isSelected ? FlintColor.fg : FlintColor.fg2)
                        .lineLimit(1)
                }
            }
            .padding(.leading, FlintMetrics.Space.s4 + CGFloat(depth) * FlintMetrics.Space.s5)
            .padding(.trailing, FlintMetrics.Space.s4)
            .frame(maxWidth: .infinity, minHeight: FlintMetrics.Size.touch, alignment: .leading)
            .background(isSelected ? FlintColor.accentSoft : .clear)
            .overlay(alignment: .leading) {
                if isSelected { FlintColor.accent.frame(width: 2) }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityLabel(title)
        .accessibilityValue(count > 0 ? count.formatted() : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder private var leadingView: some View {
        switch leading {
        case .icon(let icon): FlintIconView(icon: icon, size: 16, color: isSelected ? FlintColor.fg : FlintColor.fg2)
        case .avatar(let address, let name): FlintAvatar(address: address, name: name, size: .s24)
        }
    }
}

/// The small mono heading above a group of rows.
struct SidebarSectionLabel: View {
    let text: String
    var identifier: String?

    var body: some View {
        Text(text)
            .flintText(.label, color: FlintColor.fg3)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.top, FlintMetrics.Space.s5)
            .padding(.bottom, FlintMetrics.Space.s2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier(identifier ?? "sidebar.section")
    }
}
