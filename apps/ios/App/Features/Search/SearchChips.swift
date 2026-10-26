import SwiftUI

/// A scrolling row of operator chips under the field. Standalone operators (`is:unread`) show as selected while they are in the
/// query and a second tap removes them; the others are added for the user to finish typing.
struct SearchChips: View {
    let text: String
    let onToggle: (SearchOperator) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: FlintMetrics.Space.s2) {
                ForEach(SearchOperator.chips) { op in
                    chip(op)
                }
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
        }
        .accessibilityIdentifier("search.chips")
    }

    private func chip(_ op: SearchOperator) -> some View {
        let selected = op.isComplete && SearchText.contains(op.token, in: text)
        return Button { onToggle(op) } label: {
            Text(op.token)
                .flintText(.data, color: selected ? FlintColor.accentFg : FlintColor.fg2)
                .padding(.horizontal, FlintMetrics.Space.s3)
                .frame(height: 32)
                .background(selected ? FlintColor.accent : FlintColor.plane2, in: shape)
                .overlay(shape.stroke(selected ? FlintColor.accent : FlintColor.line, lineWidth: 1))
                .frame(minHeight: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(op.token) \(op.hint)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("search.chip.\(op.token)")
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control) }
}
