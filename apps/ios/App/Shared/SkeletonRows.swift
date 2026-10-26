import SwiftUI

/// Placeholder rows for a list that is loading. Same geometry as `FlintRow`, static, no spinner.
struct SkeletonRows: View {
    var count = 8
    var density: FlintRow.Density = .comfortable

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { _ in FlintSkeletonRow(density: density) }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Loading", tableName: "Shared"))
        .accessibilityIdentifier("shared.skeleton")
    }
}
