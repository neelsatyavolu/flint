import SwiftUI

/// Top of a sheet: a close button, a left-aligned title and trailing actions, on an opaque plane with a hairline below.
/// Built on `FlintBar` so sheets and screens share one header look.
struct SheetHeader<Trailing: View>: View {
    let title: String
    var identifier = "sheet"
    var closeLabel = String(localized: "Close", table: "Shared")
    let onClose: () -> Void
    @ViewBuilder var trailing: Trailing

    var body: some View {
        FlintBar(
            title: title, plane: FlintColor.plane1,
            leading: { FlintIconButton(icon: .close, label: closeLabel, identifier: "\(identifier).close", action: onClose) },
            trailing: { trailing })
            .accessibilityIdentifier("\(identifier).header")
    }
}

extension SheetHeader where Trailing == EmptyView {
    init(title: String, identifier: String = "sheet", onClose: @escaping () -> Void) {
        self.init(title: title, identifier: identifier, onClose: onClose, trailing: { EmptyView() })
    }
}
