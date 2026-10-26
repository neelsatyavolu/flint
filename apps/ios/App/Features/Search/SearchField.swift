import SwiftUI

/// The text field with its search icon and a clear button. Return runs the search and remembers it.
struct SearchField: View {
    @Binding var text: String
    var focused: FocusState<Bool>.Binding
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s2) {
            FlintIconView(icon: .search, size: 16, color: FlintColor.fg3)
            TextField(String(localized: "Search mail", table: "Search"), text: $text)
                .flintText(.body)
                .focused(focused)
                .submitLabel(.search)
                .onSubmit(onSubmit)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("search.field")
            if !text.isEmpty {
                Button {
                    text = ""
                    focused.wrappedValue = true
                } label: {
                    FlintIconView(icon: .close, size: 14, color: FlintColor.fg3)
                        .frame(width: FlintMetrics.Size.touch, height: FlintMetrics.Size.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Clear search", table: "Search"))
                .accessibilityIdentifier("search.clear")
            }
        }
        .padding(.leading, FlintMetrics.Space.s3)
        .frame(minHeight: FlintMetrics.Size.touch)
        .background(FlintColor.plane2, in: shape)
        .overlay(shape.stroke(focused.wrappedValue ? FlintColor.accent : FlintColor.lineStrong, lineWidth: 1))
    }

    private var shape: RoundedRectangle { RoundedRectangle(cornerRadius: FlintMetrics.Radius.control) }
}
