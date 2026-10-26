import FlintModel
import SwiftUI

/// The body of an expanded message: the blocked-images notice, the Original / Adapted toggle, the text or HTML with older
/// quoted text folded behind a pill, and a one-line tracker note.
struct MessageBodyView: View {
    let message: MessageView
    let vm: ThreadModel

    @Environment(AppModel.self) private var app
    @Environment(\.colorScheme) private var scheme
    @State private var quotedOpen = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s3) {
            if !hasBody {
                loading
            } else {
                if blocked { imageNotice }
                else if message.hasTrackers { trackerNote }
                if message.html != nil, appearance.canToggle { originalToggle }
                content
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasBody: Bool { message.bodyLoaded || message.html != nil || message.text != nil }
    private var blocked: Bool { message.remoteImages == .blocked }
    private var allowImages: Bool { message.remoteImages == .allowed }

    private var appearance: MailAppearance {
        vm.appearance(for: message, dark: scheme == .dark, matchTheme: app.settings?.appearance.emailAppearance != .light)
    }

    @ViewBuilder private var content: some View {
        if let html = message.html {
            let parts = QuotedText.splitHTML(html, subject: message.subject)
            frame(parts.body, id: "thread.body.\(message.id)", verdict: true)
            if let quoted = parts.quoted {
                QuotePill(open: $quotedOpen, identifier: "thread.quoted.\(message.id)")
                if quotedOpen { frame(quoted, id: "thread.quotedBody.\(message.id)", verdict: false) }
            }
        } else {
            plain(message.text ?? "")
        }
    }

    private func frame(_ html: String, id: String, verdict: Bool) -> some View {
        MailFrameView(
            html: html, message: message, appearance: appearance, allowImages: allowImages, vm: vm, identifier: id, reportsVerdict: verdict)
    }

    @ViewBuilder private func plain(_ text: String) -> some View {
        let parts = QuotedText.splitPlain(text)
        Text(parts.body).flintText(.prose).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("thread.body.\(message.id)")
        if !parts.quoted.isEmpty {
            QuotePill(open: $quotedOpen, identifier: "thread.quoted.\(message.id)")
            if quotedOpen {
                Text(parts.quoted).flintText(.prose, color: FlintColor.fg3).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    // MARK: Notices

    private var imageNotice: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            Text(message.hasTrackers
                ? String(localized: "Remote images are blocked and tracking pixels removed.", table: "Thread")
                : String(localized: "Remote images are blocked.", table: "Thread"))
                .flintText(.body, color: FlintColor.fg2)
            HStack(spacing: FlintMetrics.Space.s2) {
                Button(String(localized: "Load images", table: "Thread")) { Task { await load(always: false) } }
                    .accessibilityIdentifier("thread.loadImages.\(message.id)")
                Button(String(localized: "Always for this sender", table: "Thread")) { Task { await load(always: true) } }
                    .accessibilityIdentifier("thread.alwaysLoadImages.\(message.id)")
            }
            .buttonStyle(FlintButtonStyle(kind: .ghost))
            .disabled(working)
        }
        .padding(FlintMetrics.Space.s3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FlintColor.plane2, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
        .accessibilityIdentifier("thread.imageNotice.\(message.id)")
    }

    private var trackerNote: some View {
        Text(String(localized: "Flint removed tracking pixels from this message.", table: "Thread"))
            .flintText(.body, color: FlintColor.fg3)
            .accessibilityIdentifier("thread.trackers.\(message.id)")
    }

    private var originalToggle: some View {
        HStack(spacing: 0) {
            segment(String(localized: "Adapted", table: "Thread"), selected: !appearance.showingOriginal, id: "thread.adapted.\(message.id)")
            segment(String(localized: "Original", table: "Thread"), selected: appearance.showingOriginal, id: "thread.original.\(message.id)")
        }
        .overlay(RoundedRectangle(cornerRadius: FlintMetrics.Radius.control).stroke(FlintColor.line, lineWidth: 1))
        .fixedSize()
    }

    private func segment(_ title: String, selected: Bool, id: String) -> some View {
        Button { if !selected { vm.flip(message.id) } } label: {
            Text(title).flintText(.label, color: selected ? FlintColor.fg : FlintColor.fg3)
                .padding(.horizontal, FlintMetrics.Space.s3)
                .frame(minHeight: FlintMetrics.Size.touch - 12)
                .background(selected ? FlintColor.active : .clear, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    private var loading: some View {
        VStack(alignment: .leading, spacing: FlintMetrics.Space.s2) {
            ForEach([0.7, 0.92, 0.55], id: \.self) { fraction in
                GeometryReader { proxy in
                    FlintColor.active.frame(width: proxy.size.width * fraction, height: 12)
                }
                .frame(height: 12)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(localized: "Loading message", table: "Thread"))
        .accessibilityIdentifier("thread.loading.\(message.id)")
    }

    private func load(always: Bool) async {
        working = true
        defer { working = false }
        do { vm.setOverride(try await app.allowRemoteImages(messageId: message.id, always: always)) } catch {
            app.toasts.show(String(localized: "Couldn't load images. Try again.", table: "Thread"), kind: .error)
        }
    }
}

/// The three-dot pill that folds quoted history, the same control as the desktop `QuotePill`.
struct QuotePill: View {
    @Binding var open: Bool
    let identifier: String

    var body: some View {
        Button { open.toggle() } label: {
            FlintIconView(icon: .more, size: 16, color: FlintColor.fg2)
                .frame(width: 44, height: 28)
                .background(FlintColor.active, in: RoundedRectangle(cornerRadius: FlintMetrics.Radius.control))
                .frame(minHeight: FlintMetrics.Size.touch)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(open ? String(localized: "Hide quoted text", table: "Thread") : String(localized: "Show quoted text", table: "Thread"))
        .accessibilityIdentifier(identifier)
    }
}
