import FlintModel
import SwiftUI

/// Codes from the last ten minutes, above the inbox. One tap copies the code and marks it used. The strip takes no room when
/// there is nothing to show, and re-checks every 15 seconds so an expired code disappears by itself.
struct CodesStrip: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            let nowMs = Int(context.date.timeIntervalSince1970 * 1000)
            let shown = CodesLogic.visible(model.codes, nowMs: nowMs)
            if !shown.isEmpty, model.settings?.codes.enabled ?? true {
                VStack(spacing: 0) {
                    ForEach(shown) { code in
                        CodeRow(code: code, nowMs: nowMs) { Task { await model.copyCode(code) } }
                    }
                    FlintHairline()
                }
                .background(FlintColor.plane2)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("codes.strip")
            }
        }
    }
}

private struct CodeRow: View {
    let code: VerificationCode
    let nowMs: EpochMs
    let copy: () -> Void

    var body: some View {
        Button(action: copy) {
            HStack(spacing: FlintMetrics.Space.s3) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(code.service.isEmpty ? code.senderDomain : code.service)
                        .flintText(.label, color: FlintColor.fg3)
                    Text(CodesLogic.remaining(code, nowMs: nowMs)).flintText(.body, color: FlintColor.fg3)
                }
                Spacer(minLength: FlintMetrics.Space.s2)
                Text(CodesLogic.display(code.code))
                    .flintText(.data, color: code.used ? FlintColor.fg3 : FlintColor.fg)
                    .accessibilityHidden(true)
                FlintIconView(icon: .copy, size: 18, color: FlintColor.accent)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, FlintMetrics.Space.s4)
            .padding(.vertical, FlintMetrics.Space.s2)
            .frame(minHeight: FlintMetrics.Size.touch)
            .contentShape(Rectangle())
        }
        .buttonStyle(FlintPressStyle(radius: 0))
        .accessibilityLabel(String(localized: "Copy \(code.service) code", table: "Codes"))
        .accessibilityValue(code.code.map(String.init).joined(separator: " "))
        .accessibilityIdentifier("codes.copy.\(code.id)")
    }
}
