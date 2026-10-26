import SwiftUI

/// Host, port, security and username for incoming (IMAP) and outgoing (SMTP) mail.
struct ServerFieldsView: View {
    @Binding var form: ServerForm

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s4) {
            section(title: String(localized: "Incoming (IMAP)", table: "Onboarding")) {
                hostAndPort(
                    host: $form.imapHost, port: $form.imapPort, secure: $form.imapSecure, prefix: "imap")
            }
            section(title: String(localized: "Outgoing (SMTP)", table: "Onboarding")) {
                hostAndPort(
                    host: $form.smtpHost, port: $form.smtpPort, secure: $form.smtpSecure, prefix: "smtp")
            }
            OnboardingField(
                label: String(localized: "Username", table: "Onboarding"), text: $form.username,
                identifier: "onboarding.server.username", contentType: .username, submitLabel: .done)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("onboarding.server")
    }

    private func section<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            Text(title).flintText(.bodyStrong)
            content()
        }
    }

    private func hostAndPort(host: Binding<String>, port: Binding<String>, secure: Binding<Bool>, prefix: String) -> some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            HStack(alignment: .top, spacing: FlintMetrics.Space.s3) {
                OnboardingField(
                    label: String(localized: "Server", table: "Onboarding"), text: host,
                    identifier: "onboarding.server.\(prefix)Host", keyboard: .URL)
                OnboardingField(
                    label: String(localized: "Port", table: "Onboarding"), text: port,
                    identifier: "onboarding.server.\(prefix)Port", keyboard: .numberPad)
                    .frame(width: 96)
            }
            Toggle(isOn: secure) {
                Text("Use TLS", tableName: "Onboarding").flintText(.body)
            }
            .tint(FlintColor.accent)
            .frame(minHeight: FlintMetrics.Size.touch)
            .accessibilityIdentifier("onboarding.server.\(prefix)Secure")
        }
    }
}
