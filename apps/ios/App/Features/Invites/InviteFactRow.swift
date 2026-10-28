import SwiftUI

/// A label and its value: "WHEN  Tue, Oct 27, 3 PM". The label sits above the value at accessibility text sizes.
struct InviteFactRow<Value: View>: View {
    let label: String
    let strike: Bool
    @ViewBuilder let value: () -> Value
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2)) : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: FlintMetrics.Space.s3))
        layout {
            Text(label).flintText(.label, color: FlintColor.fg3)
                .frame(width: typeSize.isAccessibilitySize ? nil : 56, alignment: .leading)
            value().strikethrough(strike).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
