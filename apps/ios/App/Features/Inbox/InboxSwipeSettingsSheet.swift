import SwiftUI

/// Chooses which actions each swipe shows. Up to three per side; the first one runs on a full swipe.
struct InboxSwipeSettingsSheet: View {
    let viewModel: InboxViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: String(localized: "Swipe actions", table: "Inbox"), identifier: "inbox.swipeSettings") { dismiss() }
            ScrollView {
                VStack(alignment: .leading, spacing: FlintMetrics.Space.s4) {
                    side(String(localized: "Swipe right", table: "Inbox"), id: "leading", keyPath: \.leading)
                    side(String(localized: "Swipe left", table: "Inbox"), id: "trailing", keyPath: \.trailing)
                    Button { change { $0 = .standard } } label: { Text("Reset to default", tableName: "Inbox") }
                        .buttonStyle(FlintButtonStyle(kind: .ghost))
                        .padding(.horizontal, FlintMetrics.Space.s4)
                        .accessibilityIdentifier("inbox.swipeSettings.reset")
                }
                .padding(.bottom, FlintMetrics.Space.s6)
            }
        }
        .background(FlintColor.plane1)
        .presentationDetents([.large])
        .accessibilityIdentifier("inbox.swipeSettings.root")
    }

    private func side(_ title: String, id: String, keyPath: WritableKeyPath<SwipeConfiguration, [SwipeAction]>) -> some View {
        let chosen = viewModel.swipe[keyPath: keyPath]
        return VStack(alignment: .leading, spacing: 0) {
            Text(title).flintText(.label).padding(.horizontal, FlintMetrics.Space.s4).padding(.vertical, FlintMetrics.Space.s2)
            ForEach(SwipeAction.allCases) { action in
                let index = chosen.firstIndex(of: action)
                Button { toggle(action, keyPath) } label: {
                    HStack {
                        Text(action.title).flintText(.body)
                        Spacer()
                        if let index {
                            Text("\(index + 1)").flintText(.data, color: FlintColor.accent)
                            FlintIconView(icon: .check, size: 16, color: FlintColor.accent)
                        }
                    }
                    .padding(.horizontal, FlintMetrics.Space.s4)
                    .frame(minHeight: FlintMetrics.Size.touch)
                    .contentShape(Rectangle())
                    .overlay(alignment: .bottom) { FlintHairline() }
                }
                .buttonStyle(FlintPressStyle(radius: 0))
                .accessibilityAddTraits(index == nil ? [] : .isSelected)
                .accessibilityIdentifier("inbox.swipeSettings.\(id).\(action.rawValue)")
            }
        }
    }

    private func toggle(_ action: SwipeAction, _ keyPath: WritableKeyPath<SwipeConfiguration, [SwipeAction]>) {
        change { config in
            var list = config[keyPath: keyPath]
            if let at = list.firstIndex(of: action) { list.remove(at: at) } else { list.append(action) }
            config[keyPath: keyPath] = Array(list.prefix(SwipeConfiguration.maxPerSide))
        }
    }

    private func change(_ edit: (inout SwipeConfiguration) -> Void) {
        var next = viewModel.swipe
        edit(&next)
        let cleaned = SwipeConfiguration(leading: next.leading, trailing: next.trailing)
        viewModel.swipe = cleaned
        cleaned.save(to: viewModel.model.defaults)
    }
}
