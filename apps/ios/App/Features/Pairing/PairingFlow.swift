import FlintPairing
import SwiftUI

/// "Set up from your Mac", presented as a sheet from Settings > Devices and from onboarding.
struct PairingFlow: View {
    @State var model: PairingModel
    /// Closes the sheet. `finished` is true when the person pressed Done after an import.
    let onClose: (_ finished: Bool) -> Void

    var body: some View {
        VStack(spacing: 0) {
            SheetHeader(title: PairingText.pl("Set up from your Mac"), identifier: "pairing") { close(finished: false) }
            content
        }
        .background(FlintColor.plane1.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("pairing.root")
        .interactiveDismissDisabled(model.step == .importing)
        .task { if let payload = model.pendingPayload { model.handle(link: payload) } }
    }

    @ViewBuilder private var content: some View {
        switch model.step {
        case .intro: PairingIntroStep(model: model)
        case .scan: PairingScanStep(model: model)
        case .confirmLink(let hosts): PairingLinkConfirmStep(hosts: hosts, connect: { model.confirmLink() }, cancel: { model.cancel() })
        case .connecting: PairingConnectingStep()
        case .code(let digits): PairingCodeStep(digits: digits) { model.cancel() }
        case .review: PairingReviewStep(model: model)
        case .importing: PairingConnectingStep(text: PairingText.pl("Adding to this iPhone…"))
        case .done: PairingDoneStep(model: model) { close(finished: true) }
        case .failed(let failure): PairingFailedStep(failure: failure) { model.retry() }
        }
    }

    private func close(finished: Bool) {
        model.cancel()
        onClose(finished)
    }
}
