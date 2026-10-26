import SwiftUI

/// Shows the current toast at the bottom of the screen: full width on iPhone, bottom right on iPad. Put it in an overlay
/// at the app root. Only the toast takes touches; everything else passes through.
struct ToastHost: View {
    let center: ToastCenter
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        ZStack(alignment: sizeClass == .regular ? .bottomTrailing : .bottom) {
            Color.clear.allowsHitTesting(false)
            if let toast = center.current {
                ToastView(toast: toast, undo: { Task { await center.performUndo() } }, dismiss: center.dismiss)
                    .padding(FlintMetrics.Space.s4)
                    .transition(.opacity.combined(with: .offset(y: 4)))
                    .id(toast.id)
            }
        }
        .flintAnimation(FlintMetrics.Motion.panel, value: center.current?.id)
    }
}

struct ToastView: View {
    let toast: ToastCenter.Toast
    let undo: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(spacing: FlintMetrics.Space.s3) {
            if toast.kind == .error {
                FlintIconView(icon: .alert, size: 16, color: FlintColor.danger)
            }
            Text(toast.message)
                .flintText(.body)
                .lineLimit(3)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("toast.message")
            if toast.undo != nil {
                Button(action: undo) {
                    Text("Undo", tableName: "Shared")
                        .flintText(.bodyStrong, color: FlintColor.accent)
                        .frame(minWidth: FlintMetrics.Size.touch, minHeight: FlintMetrics.Size.touch)
                        .contentShape(Rectangle())
                }
                .buttonStyle(FlintPressStyle())
                .accessibilityIdentifier("toast.undo")
            }
        }
        .padding(.leading, FlintMetrics.Space.s4)
        .padding(.trailing, toast.undo == nil ? FlintMetrics.Space.s4 : FlintMetrics.Space.s2)
        .padding(.vertical, FlintMetrics.Space.s1)
        .frame(minHeight: FlintMetrics.Size.touch)
        .frame(maxWidth: 420)
        .background(FlintColor.plane3, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.lineStrong, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("toast.root")
        .onTapGesture(perform: dismiss)
    }
}
