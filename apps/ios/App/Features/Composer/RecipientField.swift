import FlintModel
import SwiftUI

/// One recipient row (To, Cc or Bcc): chips for the addresses so far, a text field for the next one, and contact suggestions
/// from the store underneath while the person types.
struct RecipientField<Trailing: View>: View {
    let label: String
    let identifier: String
    @Binding var addresses: [Address]
    var invalid = false
    var autoFocus = false
    let suggest: (String) async -> [Contact]
    @ViewBuilder var trailing: Trailing

    @State private var text = ""
    @State private var suggestions: [Contact] = []
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: FlintMetrics.Space.s2) {
                Text(label)
                    .flintText(.label, color: invalid ? FlintColor.danger : FlintColor.fg3)
                    .frame(width: 36, height: FlintMetrics.Size.touch, alignment: .leading)
                    .accessibilityHidden(true)
                ComposerFlowLayout(spacing: FlintMetrics.Space.s1) {
                    ForEach(addresses, id: \.address) { address in
                        RecipientChip(address: address, identifier: identifier) {
                            addresses = RecipientParsing.removing(address.address, from: addresses)
                        }
                    }
                    field
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
                trailing
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            if !suggestions.isEmpty { suggestionList }
            FlintHairline()
        }
        .task(id: text) { await refreshSuggestions() }
        .onChange(of: focused) { _, isFocused in if !isFocused { commit(all: true) } }
        .onAppear { if autoFocus { focused = true } }
    }

    private var field: some View {
        TextField("", text: $text, prompt: Text(addresses.isEmpty ? String(localized: "Add a name or address", table: "Composer") : ""))
            .flintText(.body)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.emailAddress)
            .submitLabel(.next)
            .focused($focused)
            .frame(minWidth: 140, minHeight: FlintMetrics.Size.touch - 12)
            .onSubmit { commit(all: true) }
            .onChange(of: text) { _, value in
                if let last = value.last, ",; \n".contains(last) { commit(all: false) }
            }
            .accessibilityLabel(label)
            .accessibilityIdentifier("\(identifier).field")
    }

    private var suggestionList: some View {
        VStack(spacing: 0) {
            ForEach(suggestions, id: \.email) { contact in
                Button { add(Address(name: contact.name, address: contact.email)) } label: {
                    HStack(spacing: FlintMetrics.Space.s3) {
                        FlintAvatar(address: contact.email, name: contact.name, size: .s24)
                        VStack(alignment: .leading, spacing: 0) {
                            if !contact.name.isEmpty { Text(contact.name).flintText(.body).lineLimit(1) }
                            Text(contact.email).flintText(.data, color: FlintColor.fg3).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, FlintMetrics.Space.s4)
                    .frame(minHeight: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
                }
                .buttonStyle(FlintPressStyle(radius: 0))
                .accessibilityIdentifier("\(identifier).suggestion.\(contact.email)")
            }
        }
        .background(FlintColor.plane2)
    }

    /// Turns the typed text into chips. A separator at the end commits what came before it; `all` also commits a last
    /// address with no separator. Text that isn't an address stays in the field.
    private func commit(all: Bool) {
        let parsed = RecipientParsing.parseList(text)
        guard !parsed.addresses.isEmpty else { return }
        let keepsTail = !all && !parsed.invalid.isEmpty
        addresses = RecipientParsing.merged(addresses, with: parsed.addresses)
        text = keepsTail ? parsed.invalid.joined(separator: ", ") : (all ? parsed.invalid.joined(separator: ", ") : "")
        suggestions = []
    }

    private func add(_ address: Address) {
        addresses = RecipientParsing.merged(addresses, with: [address])
        text = ""
        suggestions = []
    }

    private func refreshSuggestions() async {
        let prefix = text.trimmingCharacters(in: CharacterSet(charactersIn: ", ;\n"))
        guard !prefix.isEmpty else { suggestions = []; return }
        try? await Task.sleep(for: .milliseconds(120))
        guard !Task.isCancelled else { return }
        let found = await suggest(prefix)
        guard !Task.isCancelled else { return }
        let taken = Set(addresses.map { $0.address.lowercased() })
        suggestions = Array(found.filter { !taken.contains($0.email.lowercased()) }.prefix(5))
    }
}

/// One address in a recipient row. Tapping removes it.
struct RecipientChip: View {
    let address: Address
    let identifier: String
    let remove: () -> Void

    var body: some View {
        Button(action: remove) {
            HStack(spacing: FlintMetrics.Space.s1) {
                Text(FlintFormat.displayName(address)).flintText(.body).lineLimit(1)
                FlintIconView(icon: .close, size: 12, color: FlintColor.fg3)
            }
            .padding(.horizontal, FlintMetrics.Space.s2)
            .frame(minHeight: 32)
            .background(FlintColor.active, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(String(localized: "Remove \(FlintFormat.displayName(address))", table: "Composer"))
        .accessibilityIdentifier("\(identifier).chip.\(address.address)")
    }
}

/// Wraps children onto new lines, left to right.
struct ComposerFlowLayout: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(width: bounds.width, subviews: subviews)
        for (index, origin) in result.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: .unspecified)
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var maxX: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            size.width = min(size.width, width)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            maxX = max(maxX, x - spacing)
        }
        return (CGSize(width: width.isFinite ? width : maxX, height: y + rowHeight), origins)
    }
}
